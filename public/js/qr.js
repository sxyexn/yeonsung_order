// public/js/qr.js

document.getElementById('generate-qr-btn').addEventListener('click', () => {
    const boothId = document.getElementById('booth-input').value;
    const qrcodeDiv = document.getElementById('qrcode');
    const urlDisplay = document.getElementById('qr-url-display');

    if (!boothId || parseInt(boothId) <= 0) {
        alert('유효한 부스/테이블 번호를 입력해 주세요.');
        return;
    }

    // 서버 URL을 자동으로 감지 (배포 시에도 유연하게 작동)
    const baseDomain = window.location.origin;
    const targetUrl = `${baseDomain}/index.html?booth=${boothId}`;

    // 이전 QR 코드 삭제
    qrcodeDiv.innerHTML = ''; 

    // QR 코드 생성
    new QRCode(qrcodeDiv, {
        text: targetUrl,
        width: 200,
        height: 200,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });

    urlDisplay.textContent = `생성된 주문 URL: ${targetUrl}`;
    console.log(`QR 코드 생성 완료: ${targetUrl}`);
});