// server.js (최종 보완 버전)

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs/promises'); // ✅ fs 모듈 추가 (파일 시스템)

// ⚠️ routes/admin.js 파일 임포트
const adminRouter = require('./routes/admin'); 
const kitchenRouter = require('./routes/kitchen'); // ✅ 주방 라우터 추가

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

pool.getConnection()
    .then(connection => {
        console.log('✅ MySQL 연결 풀 생성 성공!');
        connection.release();
    })
    .catch(err => {
        console.error('❌ MySQL 연결 풀 생성 실패:', err.message);
    });

// 💡 데이터베이스 초기화 함수: schema.sql 실행
async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        const sqlFilePath = path.resolve(__dirname, 'sql', 'schema.sql'); 
        
        // 💡 fs/promises를 사용하면 readFile에서 경로 오류를 잡아낼 수 있습니다.
        const sql = await fs.readFile(sqlFilePath, { encoding: 'utf-8' });
        
        await connection.query(sql);
        connection.release();
        
        console.log('✅ MySQL DB 초기화 및 메뉴 데이터 삽입 성공!');
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.error('❌ schema.sql 파일을 찾을 수 없습니다. 경로를 확인하세요:', err.path);
        } else {
             console.error('❌ DB 연결 또는 schema.sql 실행 실패. 서버를 종료합니다.');
        }
        console.error('오류 메시지:', err.message);
        process.exit(1); // 💡 중요: 실패 시 서버 강제 종료 (ngrok이 실행되지 않도록)
    }
}


// ===========================================
// 2. 정적 파일 및 사용자/관리자 라우팅 설정
// (기존 코드와 동일)
// ===========================================
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'start.html'));
});

// ✅ kitchen.html 경로 수정 (public/admin/kitchen.html을 가리키도록)
app.get('/kitchen.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'kitchen.html'));
});

// ✅ /admin/dashboard.html 라우팅 추가
app.get('/admin/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html'));
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
            // order_items에서 단가(unit_price)를 포함하여 조회
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

//'/api/admin' 경로로 routes/admin.js 연결
app.use('/api/admin', adminRouter);
app.use('/api/kitchen', kitchenRouter); // ✅ 주방 라우터 연결 추가


// ===========================================
// 5. Socket.IO 실시간 통신
// (기존 코드와 동일)
// ===========================================

// ⚠️ 기존 activeOrders 변수 유지
let activeOrders = []; 

io.on('connection', (socket) => {
    console.log('🔗 새 클라이언트 연결됨');
    
    // ⚠️ 기존 initial_orders 이벤트 유지 (주문 중심 현황판 호환성)
    socket.emit('initial_orders', activeOrders);

    // ✅ 주방 개편을 위한 초기 항목 목록 전송 (새로운 kitchen.js용)
    loadActiveItems().then(items => {
        socket.emit('initial_items', items); 
    });

    // 고객 주문 접수 (submit_order 이벤트) - 기존 유지
    socket.on('submit_order', async (orderData) => {
        try {
            // DB에 주문 정보 저장 (status: 'pending', payment_status: 'unpaid'로 저장)
            const [orderResult] = await pool.query(
                // 💡 payment_status 컬럼 추가
                'INSERT INTO orders (booth_id, total_price, status, payment_status, order_time, note) VALUES (?, ?, ?, ?, NOW(), ?)',
                // 'pending' (status) 다음으로 'unpaid' (payment_status) 값 추가
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
    
    // ✅ 관리자가 입금 확인 완료 시 (payment_confirmed_push) - 기존 activeOrders 업데이트 + 새 항목 푸시 로직 통합
    socket.on('payment_confirmed_push', async (data) => {
        const orderId = data.order_id;
        
         try {
        // ✅ [수정] 주문에 포함된 모든 항목을 항목 단위로 조회 (주방 개편 및 기존 activeOrders 업데이트를 위해 상세 조회)
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
            // 1. ✅ 신형 주방 현황판 (항목별) 업데이트 로직
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
                io.emit('new_kitchen_item', newItem); // 👈 **이 이벤트가 항목을 표시합니다.**
            });
            
            // 2. ⚠️ 기존 activeOrders 업데이트 로직 (호환성 유지)
            // (기존 코드에서 GROUP_CONCAT으로 처리했던 데이터를 재구성합니다.)
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
            io.emit('new_order', newOrderToKitchen); // 기존 new_order 이벤트 유지 (구형 주방용)
            
            console.log(`[입금 확인 완료] ID: ${orderId}, ${itemRows.length}개 항목 주방으로 전송.`);
        }
    } catch (error) {
        console.error(`payment_confirmed_push 처리 중 오류 (ID: ${orderId}):`, error);
    }
    });
    
    // 주방에서 메뉴 상태 변경 (change_item_status 이벤트) - 기존 유지 + 푸시 강화
    socket.on('change_item_status', async (data) => {
        const { item_id, new_status } = data; // order_id는 기존 호환성을 위해 데이터에서 추출 필요

        if (['cooking', 'ready_to_serve'].includes(new_status)) {
            // DB 업데이트는 routes/kitchen.js가 처리했으므로, 여기서는 모든 클라이언트에게 푸시만 합니다.
            io.emit('item_status_updated', { item_id, new_status });
            
            // ⚠️ 필요하다면, 여기서 activeOrders 내부의 해당 항목 상태도 업데이트해야 합니다.
            // (새 주방 클라이언트는 item_status_updated로 로컬 데이터 업데이트)
            
            console.log(`[메뉴 상태 변경] ID: ${item_id}, 상태: ${new_status} (모든 클라이언트 푸시).`);
        }
    });

    // **새로운 Socket.IO 이벤트: 서빙 완료 시**
    socket.on('serving_completed_push', (data) => {
        const { item_id, order_id } = data;
        
        // ⚠️ 필요하다면, 여기서 activeOrders에서도 해당 항목을 제거하는 로직이 필요합니다.
        
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
// (기존 코드와 동일)
// ===========================================

// ⚠️ 기존 activeOrders 로드 함수 유지 (호환성)
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

// ✅ 주방 개편을 위한 항목 로드 함수 추가
async function loadActiveItems() { 
    try {
        const query = `
            SELECT
                oi.item_id, oi.order_id, oi.quantity, oi.item_status,
                o.booth_id, o.order_time,
                m.name AS menu_name
            FROM order_items oi
            JOIN orders o ON oi.order_id = o.order_id
            JOIN menus m ON oi.menu_id = m.menu_id
            WHERE oi.item_status IN ('processing', 'cooking', 'ready_to_serve')
            ORDER BY o.order_time ASC;
        `;
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
        // 1. DB 초기화 (schema.sql 실행)
        await initializeDatabase();
        
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
        // initializeDatabase에서 이미 exit(1)을 호출하므로, 이 부분은 예비용입니다.
        console.error('❌ 서버 시작 중 치명적인 오류 발생:', error);
        process.exit(1); 
    }
})();