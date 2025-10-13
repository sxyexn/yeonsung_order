// server.js (최종 버전: DB 초기화 제거)

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs/promises'); // ❌ 이제 사용되지 않음

const adminRouter = require('./routes/admin'); 
const kitchenRouter = require('./routes/kitchen'); 

// .env 파일 로드
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    // ✅ CORS 설정 추가
    cors: {
        origin: "*", // 모든 도메인(ngrok 포함)에서의 접속을 허용합니다.
        methods: ["GET", "POST"]
    }
});

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
    multipleStatements: true, 
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

// 💡 initializeDatabase 함수 삭제. 이제 DB는 외부에서 수동으로 초기화해야 합니다.

// ===========================================
// 2. 정적 파일 및 사용자/관리자 라우팅 설정
// ===========================================
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'start.html'));
});

// kitchen.html 경로 수정
app.get('/kitchen.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'kitchen.html'));
});

// /admin/dashboard.html 라우팅 추가
app.get('/admin/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html'));
});

app.get('/admin/completed.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'completed.html'));
});

// 메뉴 목록을 가져오는 API 엔드포인트
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
// 3. 관리자 페이지 API 라우터 연결
// ===========================================

app.use('/api/admin', adminRouter);
app.use('/api/kitchen', kitchenRouter);


// ===========================================
// 5. Socket.IO 실시간 통신
// ===========================================

let activeOrders = []; 

io.on('connection', (socket) => {
    console.log('🔗 새 클라이언트 연결됨');
    
    // 기존 initial_orders 이벤트 유지 (주문 중심 현황판 호환성)
    socket.emit('initial_orders', activeOrders);

    // 주방 개편을 위한 초기 항목 목록 전송 (새로운 kitchen.js용)
    loadActiveItems().then(items => {
        socket.emit('initial_items', items); 
    });

    // 고객 주문 접수 (submit_order 이벤트)
    socket.on('submit_order', async (orderData) => {
        try {
            const [orderResult] = await pool.query(
                'INSERT INTO orders (booth_id, total_price, status, payment_status, order_time, note) VALUES (?, ?, ?, ?, NOW(), ?)',
                [orderData.booth_id, orderData.total_price, 'pending', 'unpaid', orderData.note || null]
            );
            const dbOrderId = orderResult.insertId;

            const itemQueries = orderData.items.map(async item => {
                const [menuRows] = await pool.query('SELECT name FROM menus WHERE menu_id = ?', [item.menu_id]);
                const menuName = menuRows.length > 0 ? menuRows[0].name : '알 수 없는 메뉴';

                await pool.query(
                    'INSERT INTO order_items (order_id, menu_id, quantity, unit_price, item_status) VALUES (?, ?, ?, ?, ?)',
                    [dbOrderId, item.menu_id, item.quantity, item.price, 'processing'] 
                );
            });
            await Promise.all(itemQueries);
            
            io.emit('new_pending_order', { order_id: dbOrderId });
            console.log(`[주문 접수] 테이블: ${orderData.booth_id}, ID: ${dbOrderId}. (입금 대기)`);

        } catch (dbError) {
            console.error('주문 DB 저장 중 오류 발생:', dbError);
        }
    });
    
    // 관리자가 입금 확인 완료 시 (payment_confirmed_push)
    socket.on('payment_confirmed_push', async (data) => {
        const orderId = data.order_id;
        
        try {
            const itemQuery = `
                SELECT 
                    oi.item_id, oi.quantity, oi.item_status, oi.order_id,
                    o.booth_id, o.order_time, o.total_price, o.status, o.payment_status,
                    m.name AS menu_name
                FROM order_items oi
                JOIN orders o ON oi.order_id = oi.order_id
                JOIN menus m ON oi.menu_id = m.menu_id
                WHERE o.order_id = ? AND o.payment_status = 'paid'
                AND oi.item_status = 'processing';
            `;
            const [itemRows] = await pool.query(itemQuery, [orderId]);
            
            if (itemRows.length > 0) {
                // 1. 새 주방 현황판 (항목별) 업데이트 로직
                itemRows.forEach(row => {
                    const newItem = {
                        item_id: row.item_id, 
                        order_id: row.order_id, 
                        menu_name: row.menu_name,
                        quantity: row.quantity,
                        booth_id: row.booth_id,
                        item_status: 'processing',
                        order_time: row.order_time,
                    };
                    io.emit('new_kitchen_item', newItem); 
                });
                
                // 2. 기존 activeOrders 업데이트 로직 (호환성 유지)
                const newOrderToKitchen = {
                    order_id: itemRows[0].order_id, 
                    booth_id: itemRows[0].booth_id, 
                    total_price: itemRows[0].total_price,
                    status: 'processing', 
                    order_time: new Date(itemRows[0].order_time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
                    raw_time: new Date(itemRows[0].order_time).getTime(),
                    items: itemRows.map(row => ({ 
                        name: row.menu_name, 
                        quantity: row.quantity,
                        item_id: row.item_id 
                    }))
                };

                activeOrders.push(newOrderToKitchen);
                io.emit('new_order', newOrderToKitchen); 
                
                console.log(`[입금 확인 완료] ID: ${orderId}, ${itemRows.length}개 항목 주방으로 전송.`);
            }
        } catch (error) {
            console.error(`payment_confirmed_push 처리 중 오류 (ID: ${orderId}):`, error);
        }
    });
    
    // 주방에서 메뉴 상태 변경 (change_item_status 이벤트)
    socket.on('change_item_status', async (data) => {
        const { item_id, new_status } = data; 
        
        io.emit('item_status_updated', { item_id, new_status });
        console.log(`[메뉴 상태 변경] ID: ${item_id}, 상태: ${new_status} (모든 클라이언트 푸시).`);
    });

    // 서빙 완료 시 (serving_completed_push)
    socket.on('serving_completed_push', (data) => {
        const { item_id, order_id } = data;
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

// 기존 activeOrders 로드 함수 유지
async function loadInitialActiveOrders() {
    try {
        const query = `SELECT o.order_id, o.booth_id, o.total_price, o.order_time, o.status, o.payment_status, GROUP_CONCAT(CONCAT(m.name, ' (', oi.quantity, '개)')) AS item_details FROM orders o JOIN order_items oi ON o.order_id = oi.order_id JOIN menus m ON oi.menu_id = m.menu_id WHERE o.payment_status = 'paid' AND o.status != 'completed' GROUP BY o.order_id ORDER BY o.order_time ASC`;
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

// 주방 개편을 위한 항목 로드 함수
async function loadActiveItems() { 
    try {
        const query = `SELECT oi.item_id, oi.order_id, oi.quantity, oi.item_status, o.booth_id, o.order_time, m.name AS menu_name FROM order_items oi JOIN orders o ON oi.order_id = o.order_id JOIN menus m ON oi.menu_id = m.menu_id WHERE oi.item_status IN ('processing', 'cooking', 'ready_to_serve') ORDER BY o.order_time ASC`;
        const [rows] = await pool.query(query);

        return rows;
    } catch (error) {
        console.error('초기 activeItems 로드 중 오류:', error);
        return [];
    }
}


const PORT = process.env.PORT || 3000;

// 서버 시작 로직: DB 초기화 -> 주문 로드 -> 서버 리스닝
(async () => {
    try {
        // 1. ❌ DB 초기화 코드 제거됨
        // await initializeDatabase(); 
        
        // 2. 기존 activeOrders (호환성용) 로드
        await loadInitialActiveOrders();
        
        // 3. 서버 리스닝 시작
        server.listen(PORT, () => {
            console.log(`✅ 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
            console.log(`📱 고객 주문: http://localhost:${PORT}/`); 
            console.log(`🍽️ 주방 현황판: http://localhost:${PORT}/kitchen.html`);
            console.log(`🧑‍💻 관리자 대시보드: http://localhost:${PORT}/admin/dashboard.html`); 
        });
    } catch (error) {
        console.error('❌ 서버 시작 중 치명적인 오류 발생:', error);
        process.exit(1); 
    }
})();