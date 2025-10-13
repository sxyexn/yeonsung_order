// routes/admin.js (최종 버전: 모든 SQL 구문 정리 완료)

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise'); 
const dotenv = require('dotenv');

// .env 파일 로드
dotenv.config();

// pool 객체를 여기서 독립적으로 생성합니다.
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// 관리자 인증 미들웨어 
function ensureAdmin(req, res, next) { 
    next(); 
}

// ----------------------------------------------------
// 1. 관리자 비밀번호 인증 API
// ----------------------------------------------------
router.post('/auth', async (req, res) => {
    const enteredPassword = req.body.password;
    const CORRECT_PASSWORD = process.env.ADMIN_PASSWORD || '1234'; 
    if (enteredPassword === CORRECT_PASSWORD) {
        return res.json({ authenticated: true, message: '인증 성공' });
    } else {
        return res.status(401).json({ authenticated: false, error: '비밀번호가 일치하지 않습니다.' });
    }
});


// ----------------------------------------------------
// 2. 모든 주문 목록 조회 API
// ----------------------------------------------------
router.get('/orders', ensureAdmin, async (req, res) => {
    try {
        // ✅ 쿼리 한 줄로 포맷팅 완료
        const query = `SELECT o.order_id, o.booth_id, o.total_price, o.order_time, o.note, o.status, o.payment_status, GROUP_CONCAT(CONCAT(m.name, ' (', oi.quantity, '개)')) AS item_details FROM orders o JOIN order_items oi ON o.order_id = oi.order_id JOIN menus m ON oi.menu_id = m.menu_id GROUP BY o.order_id ORDER BY o.order_time DESC`; 
        const [rows] = await pool.query(query);

        const orders = rows.map(row => {
            return {
                order_id: row.order_id,
                booth_id: row.booth_id,
                total_price: row.total_price,
                order_time: row.order_time,
                note: row.note,
                is_paid: row.payment_status === 'paid', 
                items: row.item_details.split(',').map(detail => {
                    const match = detail.trim().match(/(.+) \((\d+)개\)/);
                    return match ? { name: match[1], quantity: parseInt(match[2]) } : { name: detail.trim(), quantity: 1 };
                })
            }
        });

        res.json({ success: true, orders: orders });
    } catch (error) {
        console.error('관리자 주문 목록 API 오류:', error.message);
        res.status(500).json({ success: false, error: '서버에서 주문 목록을 가져오는 데 실패했습니다.' });
    }
});


// ----------------------------------------------------
// 3. 서빙 대기 메뉴 목록 조회 API
// ----------------------------------------------------
router.get('/serving-items', ensureAdmin, async (req, res) => {
    try {
        // ✅ 쿼리 한 줄로 포맷팅 완료
        const query = `SELECT oi.item_id, oi.order_id, oi.quantity, oi.item_status, o.booth_id, o.order_time, m.name AS menu_name FROM order_items oi JOIN orders o ON oi.order_id = o.order_id JOIN menus m ON oi.menu_id = m.menu_id WHERE oi.item_status = 'ready_to_serve' ORDER BY o.order_time ASC`;
        const [rows] = await pool.query(query);

        res.json({ success: true, items: rows });
    } catch (error) {
        console.error('서빙 목록 API 오류:', error.message);
        res.status(500).json({ success: false, error: '서버에서 서빙 목록을 가져오는 데 실패했습니다.' });
    }
});


// ----------------------------------------------------
// 4. 입금 확인 처리 API (DB 업데이트만)
// ----------------------------------------------------
router.post('/confirm-payment', ensureAdmin, async (req, res) => {
    const orderId = req.body.order_id;
    if (!orderId) return res.status(400).json({ success: false, error: '주문 ID가 필요합니다.' });

    try {
        // ✅ 쿼리 한 줄로 포맷팅 완료
        const [result] = await pool.query(
            `UPDATE orders SET payment_status = 'paid', status = 'processing' WHERE order_id = ? AND payment_status = 'unpaid'`, 
            [orderId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: '해당 주문을 찾을 수 없거나 이미 입금 확인 처리되었습니다.' });
        }
        
        res.json({ success: true, message: `주문 #${orderId} 입금 확인 및 조리 대기 상태로 변경 완료.` });

    } catch (error) {
        console.error(`입금 확인 처리 중 DB 오류 (ID: ${orderId}):`, error.message);
        res.status(500).json({ success: false, error: '서버에서 입금 확인 처리에 실패했습니다.' });
    }
});


// ----------------------------------------------------
// 5. 서빙 완료 처리 API (DB 업데이트만)
// ----------------------------------------------------
router.post('/complete-serving', ensureAdmin, async (req, res) => {
    const { item_id, order_id } = req.body;
    if (!item_id) return res.status(400).json({ success: false, error: '메뉴 항목 ID가 필요합니다.' });

    try {
        // ✅ 쿼리 한 줄로 포맷팅 완료
        const [result] = await pool.query(
            `UPDATE order_items SET item_status = 'served' WHERE item_id = ? AND item_status = 'ready_to_serve'`,
            [item_id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: '해당 메뉴 항목을 찾을 수 없거나 이미 서빙 완료되었습니다.' });
        }

        res.json({ success: true, message: `메뉴 항목 ID: ${item_id} 서빙 완료 처리되었습니다.` });

    } catch (error) {
        console.error(`서빙 완료 처리 중 DB 오류 (ID: ${item_id}):`, error.message);
        res.status(500).json({ success: false, error: '서버에서 서빙 완료 처리에 실패했습니다.' });
    }
});


// ----------------------------------------------------
// 6. 완료 주문 목록 조회 API 
// ----------------------------------------------------
router.get('/completed-orders', ensureAdmin, async (req, res) => {
    try {
        // ✅ 쿼리 한 줄로 포맷팅 완료
        const query = `SELECT o.order_id, o.booth_id, o.total_price, o.order_time, o.note, o.status, o.payment_status, GROUP_CONCAT(CONCAT(m.name, ' (', oi.quantity, '개)')) AS item_details FROM orders o JOIN order_items oi ON o.order_id = oi.order_id JOIN menus m ON oi.menu_id = m.menu_id WHERE o.payment_status = 'paid' AND o.order_id NOT IN (SELECT DISTINCT order_id FROM order_items WHERE item_status IN ('processing', 'cooking', 'ready_to_serve')) GROUP BY o.order_id ORDER BY o.order_time DESC`;
            
        const [rows] = await pool.query(query);

        // 데이터 가공 로직은 기존 /orders와 동일하게 유지
        const orders = rows.map(row => {
            return {
                order_id: row.order_id,
                booth_id: row.booth_id,
                total_price: row.total_price,
                order_time: row.order_time,
                note: row.note,
                is_paid: true,
                is_completed: true, 
                items: row.item_details.split(',').map(detail => {
                    const match = detail.trim().match(/(.+) \((\d+)개\)/);
                    return match ? { name: match[1], quantity: parseInt(match[2]) } : { name: detail.trim(), quantity: 1 };
                })
            }
        });

        res.json({ success: true, orders: orders });
    } catch (error) {
        console.error('관리자 완료 주문 목록 API 오류:', error.message);
        res.status(500).json({ success: false, error: '서버에서 완료 주문 목록을 가져오는 데 실패했습니다.' });
    }
});


module.exports = router;