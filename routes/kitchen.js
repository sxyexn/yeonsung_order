// routes/kitchen.js (새로 생성)

const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise'); 
const dotenv = require('dotenv');

// .env 파일 로드
dotenv.config();

// 💡 DB 풀을 여기서 독립적으로 다시 생성합니다. (server.js와 동일한 방식)
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ----------------------------------------------------
// 메뉴 항목 상태 변경 API
// ----------------------------------------------------
router.post('/change-status', async (req, res) => {
    const { item_id, new_status } = req.body;
    
    if (!item_id || !['cooking', 'ready_to_serve'].includes(new_status)) {
        return res.status(400).json({ success: false, error: '유효하지 않은 요청입니다.' });
    }

    try {
        // DB의 order_items 테이블에서 항목 상태를 업데이트
        const [result] = await pool.query(
            `UPDATE order_items
             SET item_status = ? 
             WHERE item_id = ?`,
            [new_status, item_id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: '해당 메뉴 항목을 찾을 수 없습니다.' });
        }
        
        // 💡 주의: Socket.IO 푸시는 server.js에서 'change_item_status' 이벤트를 받아 처리합니다.

        res.json({ success: true, message: `항목 ID: ${item_id} 상태가 ${new_status}로 변경 완료.` });

    } catch (error) {
        console.error(`주방 항목 상태 변경 DB 오류 (ID: ${item_id}):`, error.message);
        res.status(500).json({ success: false, error: '서버에서 상태 변경 처리에 실패했습니다.' });
    }
});


module.exports = router;