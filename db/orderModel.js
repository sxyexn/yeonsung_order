// db.js 파일에서 DB 연결 풀(Pool)을 가져옵니다.
const pool = require('./db'); // 경로를 프로젝트 구조에 맞게 수정하세요.

/**
 * 모든 주문 목록과 상세 항목을 조회합니다.
 * (입금 상태 확인용: is_paid 필드를 추가했습니다.)
 * @returns {Promise<Array>} 주문 목록 배열 (order_id, total_price, is_paid 등이 포함됨)
 */
async function getAllOrdersWithItems() {
    // ⚠️ 참고: order_items의 menu_id를 이용하여 menus 테이블에서 name을 JOIN해야 합니다.
    // 복잡성을 줄이기 위해, 아래 쿼리는 주문(orders)과 상세 항목(order_items)을 한 번에 가져오는 쿼리입니다.
    // 프론트엔드 JS에서 필요한 형태로 데이터를 가공해야 합니다.

    const query = `
        SELECT
            o.order_id,
            o.booth_id,
            o.total_price,
            o.order_time,
            o.note,
            CASE 
                WHEN o.status = 'pending' THEN 0 
                ELSE 1 
            END AS is_paid,  -- 입금 확인 여부를 is_paid (0: 미확인, 1: 확인)로 가정
            GROUP_CONCAT(CONCAT(m.name, ' (', oi.quantity, '개)')) AS item_details
        FROM orders o
        JOIN order_items oi ON o.order_id = oi.order_id
        JOIN menus m ON oi.menu_id = m.menu_id
        GROUP BY o.order_id
        ORDER BY o.order_time DESC;
    `;

    try {
        // pool.query는 Promise를 반환한다고 가정합니다.
        const [rows] = await pool.query(query); 
        
        // 프론트엔드에서 사용하기 쉽도록 데이터를 가공합니다.
        const processedOrders = rows.map(row => ({
            order_id: row.order_id,
            booth_id: row.booth_id,
            total_price: row.total_price,
            order_time: row.order_time,
            note: row.note,
            is_paid: row.is_paid === 1,
            // item_details 문자열을 파싱하여 items 배열로 변환 (프론트엔드 admin.js 구조에 맞춤)
            items: row.item_details.split(',').map(detail => {
                const match = detail.trim().match(/(.+) \((\d+)개\)/);
                return match ? { name: match[1], quantity: parseInt(match[2]) } : { name: detail.trim(), quantity: 1 };
            })
        }));
        
        return processedOrders;

    } catch (error) {
        console.error('DB 쿼리 오류 (getAllOrdersWithItems):', error);
        throw new Error('주문 데이터 조회 실패');
    }
}

/**
 * 특정 주문의 입금 상태를 'pending'에서 'processing'으로 업데이트합니다.
 * 'processing'은 입금 확인 완료이자 '조리 대기' 상태를 의미합니다.
 * @param {number} orderId - 입금 확인 처리할 주문 ID
 */
async function updatePaymentStatus(orderId) {
    // status 필드를 'pending'에서 'processing'으로 변경
    const query = `
        UPDATE orders
        SET status = 'processing'
        WHERE order_id = ? AND status = 'pending';
    `;

    try {
        const [result] = await pool.query(query, [orderId]);
        return result.affectedRows; // 업데이트된 행의 개수를 반환합니다.
    } catch (error) {
        console.error('DB 쿼리 오류 (updatePaymentStatus):', error);
        throw new Error('입금 상태 업데이트 실패');
    }
}

module.exports = {
    getAllOrdersWithItems,
    updatePaymentStatus
};