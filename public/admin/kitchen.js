// public/admin/kitchen.js (최종 수정)

const socket = io();
const itemContainer = document.getElementById('item-container');
const totalCountElement = document.getElementById('total-count');
let activeItems = []; // 현재 주방 현황판에 표시되는 전체 메뉴 항목 리스트

document.addEventListener('DOMContentLoaded', () => {
    // 1. Socket.IO 이벤트 리스너 설정
    setupSocketListeners();
    
    // 2. 항목 컨테이너에 클릭 이벤트 리스너를 설정하여 버튼 클릭을 처리
    itemContainer.addEventListener('click', handleItemAction);
});

// ==========================================================
// 1. DOM 및 렌더링 함수
// ==========================================================

// 개별 메뉴 항목 카드 생성 함수
function createItemCard(item) {
    const statusClass = item.item_status;
    
    const card = document.createElement('div');
    card.className = `item-card ${statusClass}`;
    card.dataset.itemId = item.item_id;

    let buttonHtml = '';
    let statusText = '';
    
    if (statusClass === 'processing') {
        // 'processing' 상태일 때: 수락 버튼
        buttonHtml = `<button class="action-btn accept-btn" data-action="accept">조리 수락</button>`;
        statusText = `<span class="processing-status">(수락 대기)</span>`;
    } else if (statusClass === 'cooking') {
        // 'cooking' 상태일 때: 조리 완료 버튼
        buttonHtml = `<button class="action-btn complete-btn" data-action="complete">조리 완료</button>`;
        statusText = `<span style="color:#3498db;">(조리 중)</span>`;
    } else if (statusClass === 'ready_to_serve') {
        // 'ready_to_serve' 상태일 때: 서빙 대기 중
        // 이 항목은 곧 서빙 페이지로 이동하므로 버튼은 없습니다.
        statusText = `<span style="color:#2ecc71; font-weight: bold;">(서빙 대기)</span>`;
    }

    card.innerHTML = `
        <div class="item-header-info">
            <h3>${item.menu_name} x ${item.quantity} ${statusText}</h3>
            <span class="table-id">T:${item.booth_id}</span>
        </div>
        <div class="item-info">
            주문 #${item.order_id} 
            <br>
            <small>주문 시간: ${formatTime(item.order_time)}</small>
        </div>
        <div class="item-actions">
            ${buttonHtml}
        </div>
    `;

    return card;
}

// 전체 항목 목록 렌더링 함수
function renderActiveItems() {
    itemContainer.innerHTML = '';
    
    // 조리 대기(processing), 조리 중(cooking) 항목만 표시
    // ready_to_serve는 서빙 페이지로 넘어가므로 주방 현황판에서는 목록에서 제외합니다.
    const itemsToShow = activeItems.filter(item => 
        item.item_status === 'processing' || item.item_status === 'cooking'
    ).sort((a, b) => new Date(a.order_time) - new Date(b.order_time)); // 오래된 주문부터 정렬
    
    itemsToShow.forEach(item => {
        itemContainer.appendChild(createItemCard(item));
    });
    
    totalCountElement.textContent = `총 조리 대기/중 메뉴: ${itemsToShow.length}개`;
}

// ==========================================================
// 2. 이벤트 핸들러 (버튼 클릭)
// ==========================================================

async function handleItemAction(event) {
    const button = event.target;
    if (!button.classList.contains('action-btn')) return;

    const card = button.closest('.item-card');
    const itemId = card.dataset.itemId;
    const action = button.dataset.action;
    let newStatus;
    let endpoint = '/api/kitchen/change-status'; // routes/kitchen.js로 API 호출

    if (action === 'accept') {
        newStatus = 'cooking';
    } else if (action === 'complete') {
        newStatus = 'ready_to_serve';
    } else {
        return;
    }
    
    // 버튼 비활성화
    button.disabled = true;
    button.textContent = '처리 중...';

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_id: itemId, new_status: newStatus })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || '상태 변경에 실패했습니다.');
        }

        // DB 업데이트 성공 후, Socket.IO로 상태 변경 알림 (server.js가 다른 클라이언트에게 푸시)
        socket.emit('change_item_status', { item_id: itemId, new_status: newStatus });
        
        // 로컬 데이터 업데이트 (즉시 UI 변경을 위해)
        updateLocalItemStatus(itemId, newStatus);
        
    } catch (error) {
        console.error(`메뉴 항목 상태 변경 오류 (ID: ${itemId}, 상태: ${newStatus}):`, error);
        alert(`메뉴 처리 중 오류가 발생했습니다: ${error.message}`);
        button.disabled = false;
        button.textContent = action === 'accept' ? '조리 수락' : '조리 완료';
    }
}

// 로컬 activeItems 리스트를 업데이트하고 UI를 다시 렌더링
function updateLocalItemStatus(itemId, newStatus) {
    const itemIndex = activeItems.findIndex(item => item.item_id == itemId);
    if (itemIndex > -1) {
        activeItems[itemIndex].item_status = newStatus;
    }
    renderActiveItems();
}

// ==========================================================
// 3. Socket.IO 리스너
// ==========================================================

function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('🔗 Socket.IO 연결 성공 (주방)');
    });

    // 1. 서버 시작 시 또는 연결 시 초기 메뉴 항목 목록 수신
    socket.on('initial_items', (initialItems) => {
        console.log(`📝 초기 메뉴 항목 ${initialItems.length}개 수신.`);
        // ✅ 필터링 로직 수정: 중복된 'completed' 필터 조건 제거
        activeItems = initialItems.filter(item => item.item_status !== 'completed' && item.item_status !== 'ready_to_serve'); 
        renderActiveItems();
    });
    
    // 2. 새로운 주문 항목 수신 (관리자가 입금 확인 완료했을 때)
    socket.on('new_kitchen_item', (newItem) => {
        console.log(`🔔 새 조리 항목 수신: ID ${newItem.item_id}`);
        activeItems.push(newItem);
        renderActiveItems();
    });

    // 3. 다른 주방 클라이언트가 상태를 변경했을 때 (또는 내가 API를 호출했을 때)
    socket.on('item_status_updated', (data) => {
        console.log(`🔄 항목 ${data.item_id} 상태 업데이트됨: ${data.new_status}`);
        updateLocalItemStatus(data.item_id, data.new_status);
        
        // 'ready_to_serve'로 바뀌면 목록에서 자동으로 사라집니다 (renderActiveItems 로직에서 필터링됨)
    });
    
    // 4. 서빙이 완료되어 항목을 삭제하라는 신호 수신 (서빙 페이지에서 보냄)
    socket.on('remove_item', (data) => {
        console.log(`🗑️ 항목 ${data.item_id} 서빙 완료로 목록에서 제거.`);
        activeItems = activeItems.filter(item => item.item_id != data.item_id);
        renderActiveItems();
    });
}

// ==========================================================
// 4. 공통 유틸리티
// ==========================================================

function formatTime(isoTime) {
    const date = new Date(isoTime);
    return date.toLocaleString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}