// server.js (최종 통합 버전)

// 모듈 가져오기
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path'); // 경로 모듈 추가

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

// DB 연결 풀 생성 (환경 변수 사용)
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// DB 연결 테스트
pool.getConnection()
    .then(connection => {
        console.log('✅ MySQL 연결 풀 생성 성공!');
        connection.release();
    })
    .catch(err => {
        console.error('❌ MySQL 연결 풀 생성 실패:', err.message);
        // 서버 시작을 막지는 않음
    });


// ===========================================
// 2. 정적 파일 및 라우팅 설정
// ===========================================

// public 폴더 내의 파일을 정적으로 서비스
app.use(express.static('public'));

// 서버의 기본 경로 (http://localhost:3000/)로 접속 시 start.html을 제공
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'start.html'));
});

// 메뉴 목록을 가져오는 API 엔드포인트
app.get('/api/menus', async (req, res) => {
    try {
        // 메뉴 테이블에서 모든 메뉴를 가져옵니다.
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
        // 1. 해당 부스의 주문 목록을 가져옵니다. (최신순 정렬)
        const [orders] = await pool.query(
            'SELECT order_id, total_price, status, order_time FROM orders WHERE booth_id = ? ORDER BY order_time DESC',
            [boothId]
        );

        if (orders.length === 0) {
            return res.json([]);
        }
        
        // 2. 각 주문의 상세 항목 (items) 정보를 메뉴 이름과 함께 병합합니다.
        const ordersWithItems = await Promise.all(orders.map(async (order) => {
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
                hour12: false // 24시간 형식으로 가정
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

let activeOrders = []; // 현재 대기 중/조리 중인 주문 목록
let nextOrderId = 1; 

io.on('connection', (socket) => {
    console.log('🔗 새 클라이언트 연결됨');

    socket.emit('initial_orders', activeOrders);


    // 고객 주문 접수 (submit_order 이벤트)
    socket.on('submit_order', async (orderData) => {
        const orderId = nextOrderId++;
        const now = new Date();

        try {
            // 1. DB에 주문 정보 저장 (orders 테이블) - note 필드 추가
            const [orderResult] = await pool.query(
                'INSERT INTO orders (booth_id, total_price, status, order_time, note) VALUES (?, ?, ?, NOW(), ?)',
                [orderData.booth_id, orderData.total_price, 'pending', orderData.note || null]
            );
            const dbOrderId = orderResult.insertId;

            // 2. 주문 항목 처리 및 메뉴 이름 조회
            const processedItems = [];
            const itemQueries = orderData.items.map(async item => {
                // 메뉴 정보를 DB에서 조회하여 이름과 함께 처리
                const [menuRows] = await pool.query(
                    'SELECT name FROM menus WHERE menu_id = ?',
                    [item.menu_id]
                );

                const menuName = menuRows.length > 0 ? menuRows[0].name : '알 수 없는 메뉴';

                // order_items 테이블에 상세 메뉴 저장
                await pool.query(
                    'INSERT INTO order_items (order_id, menu_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
                    [dbOrderId, item.menu_id, item.quantity, item.price]
                );

                // 주방 전송용 배열에 메뉴 이름과 함께 추가
                processedItems.push({
                    menu_id: item.menu_id,
                    name: menuName, 
                    quantity: item.quantity,
                    price: item.price
                });
            });
            await Promise.all(itemQueries);
            
            // 3. 주방으로 전송할 주문 객체 생성
            const newOrder = {
                order_id: orderId,
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
    socket.on('change_status', (data) => {
        const { order_id, new_status } = data;
        
        const orderIndex = activeOrders.findIndex(order => order.order_id === order_id);

        if (orderIndex !== -1) {
            const oldStatus = activeOrders[orderIndex].status;

            if (new_status === 'completed') {
                const completedOrder = activeOrders.splice(orderIndex, 1)[0];
                io.emit('remove_order', order_id);
                console.log(`[주문 완료] ID: ${order_id}`);
            } else {
                activeOrders[orderIndex].status = new_status;
                io.emit('status_updated', { order_id, new_status });
                console.log(`[상태 변경] ID: ${order_id}, ${oldStatus} -> ${new_status}`);
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
    console.log(`📱 고객 주문: http://localhost:${PORT}/`); 
    console.log(`🍽️ 조리 현황판: http://localhost:${PORT}/kitchen.html`);
});