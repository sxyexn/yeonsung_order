// public/js/kitchen.js (주문 표시 오류 수정 통합 버전)

const socket = io();

// 주문을 화면에 표시하는 함수
function displayOrder(order) {
    // 1. 이미 존재하는 주문이면 업데이트만 수행 (새 주문일 경우 false)
    if (document.getElementById(`order-${order.order_id}`)) {
        return updateOrderStatus(order.order_id, order.status);
    }
    
    const card = document.createElement('div');
    card.className = `order-card status-${order.status}`;
    card.id = `order-${order.order_id}`;

    // 주문 항목 목록 생성: 서버에서 받은 items 배열 사용
    const itemsHtml = order.items.map(item => 
        // 🚨 item.name (메뉴 이름)이 정확히 들어있는지 확인
        `<li>${item.name} (${item.quantity}개)</li>` 
    ).join('');

    card.innerHTML = `
        <div class="order-header">
            <div class="booth-id">테이블 ${order.booth_id}</div> 
            <div class="order-time">${order.order_time}</div>
        </div>
        
        <ul class="order-items">
            ${itemsHtml}
        </ul>

        <div class="order-actions">
            ${createActionButton(order.order_id, order.status)}
        </div>
    `;

    // 이벤트 리스너 추가 (새 카드에 버튼 이벤트 연결)
    const actionButton = card.querySelector('.btn-status');
    if (actionButton) {
        actionButton.addEventListener('click', () => {
            handleStatusChange(order.order_id, order.status);
        });
    }

    const dashboard = document.getElementById('order-dashboard');
    
    // 새 주문은 맨 위에 추가
    dashboard.prepend(card); 
}

// 주문 상태에 따른 버튼 HTML 생성
function createActionButton(orderId, status) {
    if (status === 'pending') {
        return `<button class="btn-status processing" data-id="${orderId}">조리 시작</button>`;
    } else if (status === 'processing') {
        return `<button class="btn-status completed" data-id="${orderId}">조리 완료</button>`;
    }
    return '';
}

// 주문 상태 변경 요청 처리
function handleStatusChange(orderId, currentStatus) {
    let newStatus;
    if (currentStatus === 'pending') {
        newStatus = 'processing';
    } else if (currentStatus === 'processing') {
        newStatus = 'completed';
    } else {
        return;
    }
    
    socket.emit('change_status', { order_id: orderId, new_status: newStatus });
}

// 주문 상태 업데이트 (UI 변경)
function updateOrderStatus(orderId, newStatus) {
    const card = document.getElementById(`order-${orderId}`);
    if (card) {
        card.classList.remove('status-pending', 'status-processing');
        card.classList.add(`status-${newStatus}`);
        
        const actionArea = card.querySelector('.order-actions');
        actionArea.innerHTML = createActionButton(orderId, newStatus);

        const newButton = card.querySelector('.btn-status');
        if (newButton) {
            newButton.addEventListener('click', () => {
                // 새로운 버튼 클릭 시, 새로운 상태(newStatus)를 기반으로 다시 처리
                handleStatusChange(orderId, newStatus);
            });
        }
    }
}

// ===================================
// Socket.IO 이벤트 리스너 (주문 수신부)
// ===================================

// 서버로부터 초기 주문 목록 수신 (주방 화면 접속 시)
socket.on('initial_orders', (orders) => {
    // 오래된 주문부터 표시하기 위해 역순으로 처리
    orders.sort((a, b) => a.raw_time - b.raw_time).forEach(displayOrder);
});

// 서버로부터 새 주문 수신 (가장 중요)
socket.on('new_order', (order) => {
    console.log('✅ 새 주문 도착:', order); // 🚨 CMD 콘솔에 이 로그가 찍히는지 확인하세요!
    displayOrder(order);
});

// 서버로부터 상태 업데이트 수신
socket.on('status_updated', (data) => {
    updateOrderStatus(data.order_id, data.new_status);
});

// 서버로부터 주문 제거 수신 (완료됨)
socket.on('remove_order', (orderId) => {
    const card = document.getElementById(`order-${orderId}`);
    if (card) {
        card.remove();
    }
});