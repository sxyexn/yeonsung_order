// server.js (MySQL 연결 및 Socket.IO 로직)

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path'); 

// .env 파일 로드
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// JSON 요청 본문 파싱 활성화
app.use(express.json());

// ===========================================
// 1. MySQL DB 연결 설정
// ===========================================

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

pool.getConnection()
    .then(connection => {
        console.log('✅ MySQL 연결 풀 생성 성공!');
        connection.release();
    })
    .catch(err => {
        console.error('❌ MySQL 연결 풀 생성 실패: .env 파일 및 DB 상태 확인 필요', err.message);
    });


// ===========================================
// 2. 정적 파일 및 API 라우팅 설정
// ===========================================

// 💡 public 폴더를 정적 파일 루트로 설정 (CSS, JS, 이미지 로드 필수)
app.use(express.static('public'));

// 기본 경로를 start.html로 설정
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'start.html'));
});

// 메뉴 목록 API (DB에서 image_url 포함 모든 정보 로드)
app.get('/api/menus', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM menus ORDER BY category DESC, menu_id ASC');
        res.json(rows);
    } catch (error) {
        console.error('메뉴 로드 중 DB 오류:', error);
        res.status(500).json({ message: '메뉴를 불러오는 데 실패했습니다.' });
    }
});

// 테이블별 주문 내역을 가져오는 API 엔드포인트
app.get('/api/orders/:boothId', async (req, res) => {
    const boothId = req.params.boothId;
    try {
        // orders 테이블에서 해당 부스의 주문 정보 조회
        const [orders] = await pool.query(
            'SELECT order_id, total_price, status, order_time FROM orders WHERE booth_id = ? ORDER BY order_time DESC',
            [boothId]
        );
        
        const ordersWithItems = await Promise.all(orders.map(async (order) => {
            // 해당 주문의 상세 항목과 메뉴 이름 조회
            const [items] = await pool.query(
                `SELECT oi.quantity, oi.unit_price, m.name 
                 FROM order_items oi
                 JOIN menus m ON oi.menu_id = m.menu_id
                 WHERE oi.order_id = ?`,
                [order.order_id]
            );
            
            // 시간 포맷 변경
            const orderTime = new Date(order.order_time).toLocaleTimeString('ko-KR', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false
            });

            return {
                order_id: order.order_id,
                total_price: order.total_price,
                status: order.status,
                order_time: orderTime,
                items: items
            };
        }));

        res.json(ordersWithItems);

    } catch (error) {
        console.error('주문 내역 로드 중 DB 오류:', error);
        res.status(500).json({ message: '주문 내역을 불러오는 데 실패했습니다.' });
    }
});


// ===========================================
// 3. Socket.IO 실시간 통신
// ===========================================

// 메모리 내에 활성 주문 목록을 저장합니다. (서버 재시작 시 초기화됨)
let activeOrders = []; 
let nextOrderId = 1; 

io.on('connection', (socket) => {
    console.log('🔗 새 클라이언트 연결됨');

    // 새로 연결된 클라이언트에게 현재 활성 주문 목록을 전송 (주방 화면용)
    socket.emit('initial_orders', activeOrders);

    // 고객 주문 접수 (submit_order 이벤트)
    socket.on('submit_order', async (orderData) => {
        const orderId = nextOrderId++;
        const now = new Date();

        try {
            // 1. DB에 주문 정보 저장 (orders 테이블)
            const [orderResult] = await pool.query(
                'INSERT INTO orders (booth_id, total_price, status, order_time, note) VALUES (?, ?, ?, NOW(), ?)',
                [orderData.booth_id, orderData.total_price, 'pending', orderData.note || null]
            );
            const dbOrderId = orderResult.insertId;

            // 2. 주문 항목 처리 및 저장
            const processedItems = [];
            await Promise.all(orderData.items.map(async item => {
                // 메뉴 이름을 가져와서 주문 항목에 추가
                const [menuRows] = await pool.query(
                    'SELECT name FROM menus WHERE menu_id = ?',
                    [item.menu_id]
                );

                const menuName = menuRows.length > 0 ? menuRows[0].name : '알 수 없는 메뉴';

                // order_items 테이블에 상세 주문 항목 저장
                await pool.query(
                    'INSERT INTO order_items (order_id, menu_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
                    [dbOrderId, item.menu_id, item.quantity, item.price]
                );

                processedItems.push({
                    menu_id: item.menu_id,
                    name: menuName, 
                    quantity: item.quantity,
                    price: item.price
                });
            }));
            
            // 3. 주방으로 전송할 주문 객체 생성
            const newOrder = {
                order_id: orderId, // 메모리상 ID
                db_id: dbOrderId, // DB 저장 ID
                booth_id: orderData.booth_id, 
                total_price: orderData.total_price,
                status: 'pending',
                order_time: now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
                raw_time: now.getTime(),
                items: processedItems 
            };
            
            // 4. 메모리 및 소켓 전송
            activeOrders.push(newOrder);
            io.emit('new_order', newOrder);
            console.log(`[주문 접수] 테이블: ${newOrder.booth_id}, ID: ${newOrder.order_id}`);

        } catch (dbError) {
            console.error('주문 DB 저장 중 오류 발생:', dbError);
        }
    });

    // 주방에서 주문 상태 변경 (change_status 이벤트)
    socket.on('change_status', async (data) => {
        const { order_id, new_status } = data;
        
        const orderIndex = activeOrders.findIndex(order => order.order_id === order_id);

        if (orderIndex !== -1) {
            const dbId = activeOrders[orderIndex].db_id;
            
            try {
                // DB의 주문 상태 업데이트
                await pool.query('UPDATE orders SET status = ? WHERE order_id = ?', [new_status, dbId]);
            } catch (error) {
                console.error('주문 상태 DB 업데이트 실패:', error);
                return; // DB 업데이트 실패 시 상태 변경을 진행하지 않음
            }

            if (new_status === 'completed') {
                activeOrders.splice(orderIndex, 1);
                io.emit('remove_order', order_id);
                console.log(`[주문 완료] ID: ${order_id}`);
            } else {
                activeOrders[orderIndex].status = new_status;
                io.emit('status_updated', { order_id, new_status });
                console.log(`[상태 변경] ID: ${order_id}, -> ${new_status}`);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('❌ 클라이언트 연결 해제');
    });
});


// ===========================================
// 4. 서버 리스닝
// ===========================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`✅ 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});