관리자 API 엔드포인트를 정의하고 처리하는 파일
GET /api/admin/orders: DB에서 미처리/전체 주문 목록을 조회
POST /api/admin/confirm-payment: 특정 주문 ID를 받아 DB에서 입금 확인 상태를 업데이트