// public/admin/assets/js/admin.js (통합 관리자 로직)

const socket = io(); // Socket.IO 연결

document.addEventListener('DOMContentLoaded', () => {
    // 1. 대시보드 인증 처리
    if (document.getElementById('go-to-payment')) {
        document.getElementById('go-to-payment').addEventListener('click', handlePaymentAuth);
    }

    // 2. 입금 확인 페이지 로직
    if (document.body.classList.contains('payment-page')) {
        fetchOrders();
        document.getElementById('pending-orders-tbody').addEventListener('click', handlePaymentConfirmation);
        // Socket.IO로 새로운 주문 알림 받기
        socket.on('new_pending_order', () => {
             console.log("새 입금 대기 주문 알림 수신. 목록 업데이트.");
             fetchOrders(); 
        });
    }

    // 3. 서빙 페이지 로직
    if (document.body.classList.contains('serving-page')) {
        fetchServingItems();
        document.getElementById('serving-items-tbody').addEventListener('click', handleServingCompletion);
        // Socket.IO로 조리 완료 알림 받기
        socket.on('item_status_updated', (data) => {
             if (data.new_status === 'ready_to_serve') {
                 console.log(`메뉴 ${data.item_id} 조리 완료 알림 수신. 서빙 목록 업데이트.`);
                 fetchServingItems();
             }
        });
    }
});

// ==========================================================
// 1. 인증 로직 (대시보드에서 payment.html로 이동 시)
// ==========================================================

async function handlePaymentAuth() {
    const password = prompt("🚨 입금 확인 페이지에 접속하려면 관리자 비밀번호를 입력하세요.");
    
    if (password === null || password.trim() === '') {
        alert("비밀번호 입력이 취소되었습니다.");
        return;
    }
    
    try {
        const response = await fetch('/api/admin/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password })
        });
        
        const result = await response.json();
        
        if (response.ok && result.authenticated) {
            alert("✅ 인증 성공! 입금 확인 페이지로 이동합니다.");
            window.location.href = 'payment.html';
        } else {
            alert(`❌ 인증 실패: ${result.error || '비밀번호가 일치하지 않습니다.'}`);
        }
    } catch (error) {
        console.error('인증 API 통신 오류:', error);
        alert('서버 오류로 인증에 실패했습니다.');
    }
}


// ==========================================================
// 2. 입금 확인 페이지 로직 (payment.html)
// ==========================================================

async function fetchOrders() {
    try {
        const response = await fetch('/api/admin/orders');
        if (!response.ok) throw new Error('주문 데이터를 가져오는 데 실패했습니다.');
        const data = await response.json();
        
        const pendingOrders = data.orders.filter(order => !order.is_paid); // is_paid: false
        const confirmedOrders = data.orders.filter(order => order.is_paid);   // is_paid: true

        renderOrders(pendingOrders, 'pending-orders-tbody');
        renderOrders(confirmedOrders, 'confirmed-orders-tbody');
        
        document.getElementById('pending-count').textContent = pendingOrders.length;
        document.getElementById('confirmed-count').textContent = confirmedOrders.length;

    } catch (error) {
        console.error('API 통신 오류:', error);
        alert('주문 목록을 불러오는 중 오류가 발생했습니다.');
    }
}

function renderOrders(orders, tbodyId) {
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';

    orders.forEach(order => {
        const orderDetails = order.items.map(item => 
            `${item.name} x ${item.quantity}개`
        ).join('\n');

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>#${order.order_id}</td>
            <td>${order.booth_id}</td>
            <td>${order.total_price.toLocaleString('ko-KR')}</td>
            <td><div class="order-details">${orderDetails}</div></td>
            <td>${formatTime(order.order_time)}</td>
            <td>
                ${!order.is_paid 
                    ? `<button class="confirm-btn" data-order-id="${order.order_id}">입금 확인</button>`
                    : `<span class="status-confirmed">확인 완료</span>`}
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function handlePaymentConfirmation(event) {
    if (!event.target.classList.contains('confirm-btn')) return;

    const button = event.target;
    const orderId = button.dataset.orderId;

    if (!confirm(`주문 #${orderId}의 입금을 확인 완료하고 조리 대기 상태로 전환하시겠습니까?`)) return;
    
    button.disabled = true;

    try {
        const response = await fetch('/api/admin/confirm-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId })
        });

        if (!response.ok) throw new Error('입금 확인 처리에 실패했습니다.');

        alert(`주문 #${orderId} 입금 확인 처리 완료. 주방으로 전송되었습니다.`);
        await fetchOrders(); // 목록 업데이트

    } catch (error) {
        console.error('입금 확인 오류:', error);
        alert(`주문 #${orderId} 입금 확인 처리 중 오류가 발생했습니다.`);
        button.disabled = false;
    }
}

// ==========================================================
// 3. 서빙 완료 페이지 로직 (serving.html)
// ==========================================================

async function fetchServingItems() {
    try {
        // 'ready_to_serve' 상태인 개별 메뉴 항목을 가져오는 새로운 API를 가정합니다.
        const response = await fetch('/api/admin/serving-items');
        if (!response.ok) throw new Error('서빙 데이터를 가져오는 데 실패했습니다.');
        const data = await response.json();
        
        renderServingItems(data.items, 'serving-items-tbody');
        document.getElementById('serving-count').textContent = data.items.length;

    } catch (error) {
        console.error('서빙 목록 API 오류:', error);
        alert('서빙 목록을 불러오는 중 오류가 발생했습니다.');
    }
}

function renderServingItems(items, tbodyId) {
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';

    items.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${item.menu_name}</td>
            <td>${item.quantity}</td>
            <td>${item.booth_id}</td>
            <td>#${item.order_id}</td>
            <td>${formatTime(item.item_updated_time)}</td>
            <td>
                <button class="serve-btn" 
                        data-item-id="${item.item_id}"
                        data-order-id="${item.order_id}">서빙 완료</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function handleServingCompletion(event) {
    if (!event.target.classList.contains('serve-btn')) return;

    const button = event.target;
    const itemId = button.dataset.itemId;
    const orderId = button.dataset.orderId;

    if (!confirm(`주문 #${orderId}의 메뉴 (ID: ${itemId})를 서빙 완료하시겠습니까?`)) return;
    
    button.disabled = true;

    try {
        // 서빙 완료 API 호출 (item_status를 'completed'로 변경)
        const response = await fetch('/api/admin/complete-serving', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: itemId, order_id: orderId })
        });

        if (!response.ok) throw new Error('서빙 완료 처리에 실패했습니다.');

        alert(`메뉴 (주문 #${orderId}) 서빙 완료 처리되었습니다.`);
        await fetchServingItems(); // 목록 업데이트

    } catch (error) {
        console.error('서빙 완료 오류:', error);
        alert(`서빙 완료 처리 중 오류가 발생했습니다.`);
        button.disabled = false;
    }
}


// ==========================================================
// 4. 공통 유틸리티
// ==========================================================

function formatTime(isoTime) {
    const date = new Date(isoTime);
    return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}