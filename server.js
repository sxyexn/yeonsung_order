// server.js (schema.sql 파일 로드 및 order_items 처리 반영)

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path'); 
const fs = require('fs/promises'); // 💡 fs/promises 모듈 추가

// .env 파일 로드
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// JSON 요청 본문 파싱 활성화
app.use(express.json());

// ===========================================
// 1. MySQL DB 연결 설정 및 초기화 로직
// ===========================================

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true, // 💡 중요: 다중 쿼리 실행 허용
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// 💡 데이터베이스 초기화 함수: schema.sql 실행
async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        const sqlFilePath = path.join(__dirname, 'schema.sql');
        
        const sql = await fs.readFile(sqlFilePath, { encoding: 'utf-8' });
        
        await connection.query(sql);
        connection.release();
        
        console.log('✅ MySQL DB 초기화 및 메뉴 데이터 삽입 성공!');
    } catch (err) {
        console.error('❌ DB 연결 또는 schema.sql 실행 실패. DB 상태와 파일 경로 확인:', err.message);
    }
}


// ===========================================
// 2. 정적 파일 및 API 라우팅 설정
// ===========================================

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'start.html'));
});

// 메뉴 목록 API
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
        const [orders] = await pool.query(
            'SELECT order_id, total_price, status, order_time FROM orders WHERE booth_id = ? ORDER BY order_time DESC',
            [boothId]
        );
        
        const ordersWithItems = await Promise.all(orders.map(async (order) => {
            // order_items에서 단가(unit_price)를 포함하여 조회
            const [items] = await pool.query(
                `SELECT oi.quantity, oi.unit_price, m.name 
                 FROM order_items oi
                 JOIN menus m ON oi.menu_id = m.menu_id
                 WHERE oi.order_id = ?`,
                [order.order_id]
            );
            
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

let activeOrders = []; 
let nextOrderId = 1; 

io.on('connection', (socket) => {
    console.log('🔗 새 클라이언트 연결됨');

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
                const [menuRows] = await pool.query(
                    'SELECT name FROM menus WHERE menu_id = ?',
                    [item.menu_id]
                );

                const menuName = menuRows.length > 0 ? menuRows[0].name : '알 수 없는 메뉴';

                // 💡 order_items에 unit_price (단가) 저장
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
                return; 
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
server.listen(PORT, async () => {
    console.log(`✅ 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
    // 💡 서버 시작 시 DB 초기화 함수 호출
    await initializeDatabase(); 
});