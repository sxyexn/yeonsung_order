// server.js (routes/admin.js 분리 버전)

// 모듈 가져오기
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');
// ⚠️ routes/admin.js 파일 임포트
const adminRouter = require('./routes/admin'); 

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
        console.error('❌ MySQL 연결 풀 생성 실패:', err.message);
    });

// ===========================================
// 2. 정적 파일 및 사용자/관리자 라우팅 설정
// ===========================================
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'start.html'));
});

app.get('/kitchen.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'kitchen.html'));
});

// 메뉴 목록을 가져오는 API 엔드포인트 (기존 유지)
app.get('/api/menus', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM menus ORDER BY category DESC, menu_id ASC');
        res.json(rows);
    } catch (error) {
        console.error('메뉴 로드 중 DB 오류:', error);
        res.status(500).json({ message: '메뉴를 불러오는 데 실패했습니다.' });
    }
});

// 테이블별 주문 내역을 가져오는 API 엔드포인트 (기존 유지)
app.get('/api/orders/:boothId', async (req, res) => {
    const boothId = req.params.boothId;

    try {
        const [orders] = await pool.query(
            'SELECT order_id, total_price, status, payment_status, order_time FROM orders WHERE booth_id = ? ORDER BY order_time DESC',
            [boothId]
        );

        if (orders.length === 0) return res.json([]);
        
        const ordersWithItems = await Promise.all(orders.map(async (order) => {
            const [items] = await pool.query(
                `SELECT oi.quantity, oi.unit_price, m.name 
                 FROM order_items oi
                 JOIN menus m ON oi.menu_id = m.menu_id
                 WHERE oi.order_id = ?`,
                [order.order_id]
            );
            
            const orderTime = new Date(order.order_time).toLocaleTimeString('ko-KR', { 
                hour: '2-digit', minute: '2-digit', hour12: false
            });

            return {
                order_id: order.order_id,
                total_price: order.total_price,
                status: order.status,
                payment_status: order.payment_status,
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
// 3. 관리자 페이지 API 라우터 연결 (새로 추가)
// ===========================================

// ⚠️ '/api/admin' 경로로 routes/admin.js 연결
app.use('/api/admin', adminRouter);


// ------------------------------------------------------------------
// 4. 관리자 API 호출 후 Socket.IO 처리 (라우터에서 분리된 로직)
// ------------------------------------------------------------------

// 입금 확인 처리 후 Socket.IO 로직을 위해 라우터의 응답을 가로챕니다.
// 이는 Express 미들웨어 방식보다 '프록시' 방식에 가깝습니다.

// 라우터 연결 후, 라우터가 응답하기 직전에 Socket.IO를 처리하도록 API를 재정의합니다.
// ⚠️ 이 부분이 복잡하므로, 가장 확실한 방법은 클라이언트(admin.js)가 DB 업데이트 후 
// API가 성공하면 다시 Socket.IO 이벤트를 서버로 보내도록 변경하는 것입니다.
// 여기서는 코드를 깨끗하게 유지하기 위해, 클라이언트 로직을 변경하는 방식을 사용하겠습니다. 
// 즉, routes/admin.js는 DB만 다루고, Socket.IO는 오직 5번 섹션에서만 다룹니다.

// **⚠️ 4번 섹션의 코드는 유지보수성을 위해 최종 코드에서 제외하며, Socket.IO 로직은 5번 섹션에서만 관리됩니다.**


// ===========================================
// 5. Socket.IO 실시간 통신
// ===========================================

let activeOrders = []; 

io.on('connection', (socket) => {
    console.log('🔗 새 클라이언트 연결됨');
    socket.emit('initial_orders', activeOrders);

    // 고객 주문 접수 (submit_order 이벤트) - 기존 유지
    socket.on('submit_order', async (orderData) => {
        try {
            // DB에 주문 정보 저장 (status: 'pending', payment_status: 'unpaid'로 저장)
            const [orderResult] = await pool.query(
                'INSERT INTO orders (booth_id, total_price, status, payment_status, order_time, note) VALUES (?, ?, ?, ?, NOW(), ?)',
                [orderData.booth_id, orderData.total_price, 'pending', 'unpaid', orderData.note || null]
            );
            const dbOrderId = orderResult.insertId;

            // 주문 항목 저장 시, item_status도 'processing'으로 초기화
            const itemQueries = orderData.items.map(async item => {
                const [menuRows] = await pool.query('SELECT name FROM menus WHERE menu_id = ?', [item.menu_id]);
                const menuName = menuRows.length > 0 ? menuRows[0].name : '알 수 없는 메뉴';

                await pool.query(
                    'INSERT INTO order_items (order_id, menu_id, quantity, unit_price, item_status) VALUES (?, ?, ?, ?, ?)',
                    [dbOrderId, item.menu_id, item.quantity, item.price, 'processing'] 
                );
            });
            await Promise.all(itemQueries);
            
            // 관리자 입금 확인 페이지에 새 'unpaid' 주문이 들어왔음을 알림
            io.emit('new_pending_order', { order_id: dbOrderId });
            console.log(`[주문 접수] 테이블: ${orderData.booth_id}, ID: ${dbOrderId}. (입금 대기)`);

        } catch (dbError) {
            console.error('주문 DB 저장 중 오류 발생:', dbError);
        }
    });
    
    // **새로운 Socket.IO 이벤트: 관리자가 입금 확인 완료 시 (admin.js에서 보냄)**
    socket.on('payment_confirmed_push', async (data) => {
        const orderId = data.order_id;
        
        // routes/admin.js에서 DB 업데이트가 성공했으므로, 여기서 정보를 다시 조회하여 푸시
        const [orderRows] = await pool.query(
            `SELECT o.order_id, o.booth_id, o.total_price, o.order_time, o.status, o.payment_status,
             GROUP_CONCAT(CONCAT(m.name, ' (', oi.quantity, '개)')) AS item_details
             FROM orders o
             JOIN order_items oi ON o.order_id = oi.order_id
             JOIN menus m ON oi.menu_id = m.menu_id
             WHERE o.order_id = ?
             GROUP BY o.order_id`,
            [orderId]
        );
        
        if (orderRows.length > 0) {
             const row = orderRows[0];
             const processedItems = row.item_details.split(',').map(detail => {
                const match = detail.trim().match(/(.+) \((\d+)개\)/);
                return match ? { name: match[1], quantity: parseInt(match[2]) } : { name: detail.trim(), quantity: 1 };
             });

            const newOrderToKitchen = {
                order_id: row.order_id, 
                booth_id: row.booth_id, 
                total_price: row.total_price,
                status: 'processing', 
                order_time: new Date(row.order_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
                raw_time: new Date(row.order_time).getTime(),
                items: processedItems
            };

            activeOrders.push(newOrderToKitchen);
            io.emit('new_order', newOrderToKitchen); 
            console.log(`[입금 확인 완료] ID: ${orderId}, 주방 현황판으로 전송.`);
        }
    });
    
    // 주방에서 메뉴 상태 변경 (change_item_status 이벤트) - 기존 유지
    socket.on('change_item_status', async (data) => {
        const { item_id, order_id, new_status } = data; 

        if (['cooking', 'ready_to_serve'].includes(new_status)) {
            try {
                // DB 업데이트는 routes/admin.js에서 처리하지만, 여기서는 Socket.IO 메시지를 받아 푸시
                // DB 업데이트는 주방페이지(kitchen.html)의 JS가 routes/admin.js를 호출한다고 가정하고,
                // 여기서는 상태 변경 알림만 처리합니다.
                
                // ⚠️ 주의: 주방 페이지 JS도 DB 업데이트 후 이 Socket.IO 이벤트를 보내도록 코드를 구성해야 합니다.
                // 여기서는 서버가 DB 업데이트 성공했다고 가정하고 푸시합니다.
                io.emit('item_status_updated', { item_id, order_id, new_status });
                console.log(`[메뉴 상태 변경] ID: ${item_id}, 상태: ${new_status}`);
                
            } catch (dbError) {
                console.error(`메뉴 상태 처리 오류:`, dbError);
            }
        }
    });

    // **새로운 Socket.IO 이벤트: 서빙 완료 시 (admin.js에서 보냄)**
    socket.on('serving_completed_push', (data) => {
        const { item_id, order_id } = data;
        // 주방 현황판에서 해당 메뉴 항목을 제거하라는 신호 전송
        io.emit('remove_item', { item_id: item_id, order_id: order_id });
        console.log(`[서빙 완료 처리] 주문 #${order_id}의 메뉴 항목 ID: ${item_id} 제거 신호 전송.`);
    });


    socket.on('disconnect', () => {
        console.log('❌ 클라이언트 연결 해제');
    });
});


// ===========================================
// 6. 서버 리스닝
// ===========================================

// 서버 시작 시 초기 activeOrders 로드 (기존 유지)
async function loadInitialActiveOrders() {
    try {
        const query = `
            SELECT
                o.order_id, o.booth_id, o.total_price, o.order_time, o.status, o.payment_status,
                GROUP_CONCAT(CONCAT(m.name, ' (', oi.quantity, '개)')) AS item_details
            FROM orders o
            JOIN order_items oi ON o.order_id = oi.order_id
            JOIN menus m ON oi.menu_id = m.menu_id
            WHERE o.payment_status = 'paid' AND o.status != 'completed' 
            GROUP BY o.order_id
            ORDER BY o.order_time ASC;
        `;
        const [rows] = await pool.query(query);

        activeOrders = rows.map(row => {
            const processedItems = row.item_details.split(',').map(detail => {
                const match = detail.trim().match(/(.+) \((\d+)개\)/);
                return match ? { name: match[1], quantity: parseInt(match[2]) } : { name: detail.trim(), quantity: 1 };
            });
            return {
                order_id: row.order_id,
                booth_id: row.booth_id,
                total_price: row.total_price,
                status: row.status,
                order_time: new Date(row.order_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
                raw_time: new Date(row.order_time).getTime(),
                items: processedItems
            };
        });
        console.log(`📝 서버 시작 시 ${activeOrders.length}개의 조리 대기/중 주문 로드됨.`);
    } catch (error) {
        console.error('초기 activeOrders 로드 중 오류:', error);
    }
}


const PORT = process.env.PORT || 3000;
loadInitialActiveOrders().then(() => {
    server.listen(PORT, () => {
        console.log(`✅ 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
        console.log(`📱 고객 주문: http://localhost:${PORT}/`); 
        console.log(`🍽️ 주방 현황판: http://localhost:${PORT}/kitchen.html`);
        console.log(`🧑‍💻 관리자 대시보드: http://localhost:${PORT}/admin/dashboard.html`); 
    });
});