import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, doc, getDoc, setDoc, getDocs, deleteDoc, updateDoc, increment, query, orderBy, arrayUnion, arrayRemove } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyBVlLiHWQQ7Sr-d_Rwdavwjojp2IXH_Gug",
  authDomain: "ch-mimeow.firebaseapp.com",
  projectId: "ch-mimeow",
  storageBucket: "ch-mimeow.firebasestorage.app",
  messagingSenderId: "633558087640",
  appId: "1:633558087640:web:b4aca508115aff9ad224ad"
};

const githubConfig = {
  owner: 'Andy080852',
  repo: 'fashion-voting',
  branch: 'main',
  path: 'images'
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentUser = null;
let adminUser = null;
let settings = null;
let submissions = [];
let githubToken = localStorage.getItem('githubToken') || '';
let currentDisplayPair = null;  // ✅ 新增：記錄當前顯示的配對

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

async function init() {
  try {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        adminUser = user;
        await loadSettings();
        showAdminPanel();
        setupAutoReset();
      } else {
        adminUser = null;
        await loadSettings();
        showLoginPage();
      }
    });
  } catch (error) {
    console.error('初始化失敗:', error);
    showError('系統初始化失敗，請重新整理頁面');
  }
}

async function loadSettings() {
  try {
    const settingsDoc = await getDoc(doc(db, 'settings', 'config'));
    if (settingsDoc.exists()) {
      settings = settingsDoc.data();
    } else {
      settings = {
        theme: '🎄 聖誕快樂 ❄️',
        maxVotes: 5,
        maxRefreshes: 15,
        showLeaderboardImages: true,
        votingStartTime: null,
        votingEndTime: null
      };
      await setDoc(doc(db, 'settings', 'config'), settings);
    }
  } catch (error) {
    console.error('載入設定失敗:', error);
    showError('載入設定失敗');
  }
}

function isVotingAllowed() {
  if (!settings.votingStartTime && !settings.votingEndTime) {
    return true;
  }
  const now = Date.now();
  const startTime = settings.votingStartTime ? new Date(settings.votingStartTime).getTime() : 0;
  const endTime = settings.votingEndTime ? new Date(settings.votingEndTime).getTime() : Infinity;
  return now >= startTime && now <= endTime;
}

function getVotingStatus() {
  if (!settings.votingStartTime && !settings.votingEndTime) {
    return { status: 'always', message: '無時間限制' };
  }
  const now = Date.now();
  const startTime = settings.votingStartTime ? new Date(settings.votingStartTime).getTime() : 0;
  const endTime = settings.votingEndTime ? new Date(settings.votingEndTime).getTime() : Infinity;
  if (now < startTime) {
    return { status: 'notStarted', message: '投票尚未開始' };
  } else if (now > endTime) {
    return { status: 'ended', message: '投票已結束' };
  } else {
    return { status: 'active', message: '投票進行中' };
  }
}

async function uploadImageToGitHub(fileBlob) {
  if (!githubToken) {
    throw new Error('請先設定 GitHub Token');
  }

  const fileReader = new FileReader();
  const base64Promise = new Promise((resolve, reject) => {
    fileReader.onload = () => {
      const base64Data = fileReader.result.split(',')[1];
      resolve(base64Data);
    };
    fileReader.onerror = reject;
    fileReader.readAsDataURL(fileBlob);
  });

  const base64Content = await base64Promise;
  const timestamp = Date.now();
  const fileName = `${timestamp}_${fileBlob.name}`;
  const filePath = `${githubConfig.path}/${fileName}`;

  const response = await fetch(`https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/contents/${filePath}`, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${githubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `Upload ${fileName}`,
      content: base64Content,
      branch: githubConfig.branch
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || '上傳失敗');
  }

  const data = await response.json();
  return {
    url: `https://raw.githubusercontent.com/${githubConfig.owner}/${githubConfig.repo}/${githubConfig.branch}/${filePath}`,
    sha: data.content.sha,
    path: filePath
  };
}

async function deleteImageFromGitHub(filePath) {
  if (!githubToken || !filePath) return;

  try {
    const getResponse = await fetch(`https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/contents/${filePath}`, {
      headers: {
        'Authorization': `token ${githubToken}`,
      }
    });

    if (!getResponse.ok) return;

    const fileData = await getResponse.json();
    await fetch(`https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/contents/${filePath}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `token ${githubToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Delete ${filePath}`,
        sha: fileData.sha,
        branch: githubConfig.branch
      })
    });
  } catch (error) {
    console.error('刪除圖片失敗:', error);
  }
}

async function setupAutoReset() {
  if (!adminUser) return;

  const now = new Date();
  const targetTime = new Date();
  targetTime.setHours(23, 59, 0, 0);

  if (now > targetTime) {
    targetTime.setDate(targetTime.getDate() + 1);
  }

  const timeUntilReset = targetTime - now;

  setTimeout(async () => {
    try {
      console.log('執行每日自動重置...');
      const usersSnapshot = await getDocs(collection(db, 'users'));
      const updatePromises = [];

      for (const userDoc of usersSnapshot.docs) {
        updatePromises.push(
          updateDoc(doc(db, 'users', userDoc.id), {
            votesRemaining: 5,
            refreshesRemaining: 15,
            votedPairs: [],
            votedWinners: []  // ✅ 清空獲勝作品記錄
          })
        );
      }

      await Promise.all(updatePromises);
      console.log(`自動重置完成，共重置 ${usersSnapshot.size} 位用戶`);
      setupAutoReset();
    } catch (error) {
      console.error('自動重置失敗:', error);
      setupAutoReset();
    }
  }, timeUntilReset);
}

function showLoginPage() {
  const app = document.getElementById('app');
  app.className = 'container';
  const votingStatus = getVotingStatus();
  const canVote = isVotingAllowed();

  app.innerHTML = `
    <h1>🎄 CH X 咪喵 第一屆<br>我要做MODEL 🎅</h1>
    ${settings ? `<div class="theme-display">${settings.theme}</div>` : ''}
    <div class="submission-notice">有興趣投稿請到 DC 聯絡 CH-時</div>
    ${!canVote ? `<div class="error">${votingStatus.message}<br>${votingStatus.status === 'notStarted' && settings.votingStartTime ? `開始時間：${new Date(settings.votingStartTime).toLocaleString('zh-TW')}` : ''} ${votingStatus.status === 'ended' && settings.votingEndTime ? `結束時間：${new Date(settings.votingEndTime).toLocaleString('zh-TW')}` : ''}</div>` : ''}
    <div class="input-group">
      <label>請輸入遊戲內的姓名</label>
      <input type="text" id="userName" placeholder="小時" ${canVote ? '' : 'disabled'}>
    </div>
    <button onclick="window.userLogin()" ${canVote ? '' : 'disabled'}>${canVote ? '🎁 開始投票' : '❌ 投票未開放'}</button>
    <button class="secondary-btn" onclick="window.showAdminLogin()">⚙️ 後台管理</button>
    <button class="secondary-btn" onclick="window.showLeaderboard()">🏆 查看排行榜</button>
  `;
}

async function showAdminPanel() {
  const app = document.getElementById('app');
  app.className = 'container admin-container';

  const submissionsSnapshot = await getDocs(collection(db, 'submissions'));
  submissions = submissionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const tokenStatus = githubToken ? 'configured' : 'not-configured';
  const tokenText = githubToken ? '✓ 已設定' : '✗ 未設定';

  const formatDateTime = (dateTimeStr) => {
    if (!dateTimeStr) return '未設定';
    return new Date(dateTimeStr).toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const votingStatus = getVotingStatus();

  app.innerHTML = `
    <h1>🎄 後台管理 🎅</h1>
    <div class="user-info">
      ${adminUser.email}
      <button class="logout-btn" onclick="window.adminLogout()">登出</button>
    </div>

    <div class="collapsible-section">
      <div class="collapse-header" onclick="window.toggleCollapse('settings')">
        <h3>系統設定</h3>
        <span class="collapse-icon" id="settings-icon">▼</span>
      </div>
      <div class="collapse-content" id="settings-content">
        <div class="collapse-inner">
          <div class="setup-box">
            <h3>GitHub Token 設定 <span class="token-status ${tokenStatus}">${tokenText}</span></h3>
            <p>為了自動上傳圖片到 GitHub，需要設定 Personal Access Token。</p>
            <div class="input-group" style="margin-top:15px">
              <label>GitHub Token</label>
              <input type="password" id="githubTokenInput" placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value="${githubToken}">
            </div>
            <button onclick="window.saveGitHubToken()">💾 儲存 Token</button>
            ${githubToken ? '<button class="secondary-btn" onclick="window.clearGitHubToken()">🗑️ 清除 Token</button>' : ''}
          </div>

          <div class="admin-section" style="margin-top:20px">
            <h2>主題設定</h2>
            <div class="input-group">
              <label>當前主題</label>
              <input type="text" id="themeInput" value="${settings.theme}">
            </div>
            <button onclick="window.updateTheme()">🎁 更新主題</button>
          </div>

          <div class="admin-section">
            <h2>投票時間設定</h2>
            <div class="time-status">
              <div class="time-status-item">
                <span class="time-status-label">📅 當前狀態</span>
                <span class="time-status-value ${votingStatus.status === 'active' ? 'active' : 'inactive'}">${votingStatus.message}</span>
              </div>
              <div class="time-status-item">
                <span class="time-status-label">🕐 開始時間</span>
                <span class="time-status-value">${formatDateTime(settings.votingStartTime)}</span>
              </div>
              <div class="time-status-item">
                <span class="time-status-label">🕐 結束時間</span>
                <span class="time-status-value">${formatDateTime(settings.votingEndTime)}</span>
              </div>
            </div>
            <div class="input-group">
              <label>開始時間</label>
              <input type="datetime-local" id="startTimeInput" value="${settings.votingStartTime || ''}">
            </div>
            <div class="input-group">
              <label>結束時間</label>
              <input type="datetime-local" id="endTimeInput" value="${settings.votingEndTime || ''}">
            </div>
            <button onclick="window.updateVotingTime()">⏰ 更新投票時間</button>
            <button class="secondary-btn" onclick="window.clearVotingTime()">🗑️ 清除時間限制</button>
          </div>
        </div>
      </div>
    </div>

    <div class="admin-section">
      <h2>排行榜管理</h2>
      <button onclick="window.updateLeaderboard()">🔄 更新排行榜</button>
      <div class="toggle-container" style="margin-top:20px">
        <span class="toggle-label">🖼️ 排行榜顯示圖片</span>
        <div class="toggle-switch ${settings.showLeaderboardImages ? 'active' : ''}" onclick="window.toggleLeaderboardImages()"></div>
      </div>
      <p style="color:#666;font-size:14px;margin-top:10px">${settings.showLeaderboardImages ? '✅ 目前：顯示圖片' : '❌ 目前：不顯示圖片'}</p>
    </div>

    <div class="admin-section">
      <h2>用戶管理</h2>
      <div class="auto-reset-info">
        <p><strong>🕐 自動重置系統</strong></p>
        <p>系統將於每晚 <strong>23:59</strong> 自動執行以下操作：</p>
        <p>• 恢復所有人的剩餘票數至 <strong>5 票</strong></p>
        <p>• 恢復所有人的刷新次數至 <strong>15 次</strong></p>
        <p>• <strong>清空投票記錄</strong>（允許重新投票給昨天投過的組合）</p>
        <p>• <strong>清空獲勝作品記錄</strong>（所有作品重新可見）</p>
        <p style="margin-top:10px;color:#1b5e20"><strong>✅ 自動重置已啟用</strong></p>
      </div>
      <div class="manual-reset-warning">
        <p><strong>⚠️ 手動立即重置</strong></p>
        <p>點擊下方按鈕可立即執行重置操作：</p>
        <p>• 恢復所有人的剩餘票數至 <strong>5 票</strong></p>
        <p>• 恢復所有人的刷新次數至 <strong>15 次</strong></p>
        <p>• <strong>清空投票記錄</strong>（允許重新投票）</p>
        <p>• <strong>清空獲勝作品記錄</strong>（所有作品重新可見）</p>
      </div>
      <button class="warning-btn" onclick="window.manualResetAllUsers()">🔄 立即重置所有用戶</button>
    </div>

    <div class="admin-section">
      <h2>上傳作品</h2>
      <div class="input-group">
        <label>作品標題</label>
        <input type="text" id="submissionTitle" placeholder="輸入作品標題">
      </div>
      <div class="input-group">
        <label>選擇圖片</label>
        <div class="file-input-wrapper">
          <input type="file" id="submissionImage" accept="image/jpeg,image/jpg,image/png,image/webp" onchange="window.previewImage(event)">
          <label for="submissionImage" class="file-input-label">
            📁 點擊上傳圖片
            <div class="file-size-info">支援 JPG/PNG/WebP，建議小於 2 MB</div>
          </label>
        </div>
        <img id="imagePreview" class="preview-image hidden">
        <div id="fileSizeDisplay" class="file-size-info"></div>
      </div>
      <div id="uploadProgress" class="progress-bar hidden">
        <div id="uploadProgressFill" class="progress-fill" style="width:0%">0%</div>
      </div>
      <button id="uploadBtn" onclick="window.uploadSubmission()" ${githubToken ? '' : 'disabled'}>${githubToken ? '🎁 上傳作品' : '⚠️ 請先設定 GitHub Token'}</button>
    </div>

    <div class="admin-section">
      <h2>作品管理與投票記錄</h2>
      <div class="submissions-grid">
        ${submissions.map(submission => {
          const votes = submission.votes || [];
          return `
            <div class="submission-card">
              <img src="${submission.imageUrl}" alt="${submission.title}">
              <div class="submission-title">${submission.title}</div>
              <div class="submission-info">⭐ 總分數: ${submission.score || 0}</div>
              <div class="submission-info">📊 投票數: ${votes.length}</div>
              <div class="vote-records">
                <h4>投票記錄</h4>
                ${votes.length > 0 ? votes.map(vote => `
                  <div class="vote-record-item">
                    <span class="voter-name">👤 ${vote.voter}</span>
                    <span class="vote-time">${vote.date}</span>
                    <button class="delete-vote-btn" onclick='window.deleteVote("${submission.id}", ${JSON.stringify(vote).replace(/'/g, '&apos;')})'>🗑️</button>
                  </div>
                `).join('') : '<div class="no-votes">暫無投票記錄</div>'}
              </div>
              <button class="delete-btn" onclick="window.deleteSubmission('${submission.id}', '${submission.imagePath || ''}')">🗑️ 刪除作品</button>
            </div>
          `;
        }).join('')}
      </div>
      ${submissions.length === 0 ? '<p style="text-align:center;color:#999">暫無作品</p>' : ''}
    </div>
  `;
}

async function showVotingPage() {
  if (!isVotingAllowed()) {
    showError('目前不在投票時間內');
    showLoginPage();
    return;
  }

  const submissionsSnapshot = await getDocs(collection(db, 'submissions'));
  submissions = submissionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const app = document.getElementById('app');
  app.className = 'container';
  app.innerHTML = `
    <h1>🎄 投票系統 🎅</h1>
    <div class="user-info">${currentUser.name}</div>
    <div class="stats">
      <div class="stat-item">
        <div class="stat-number">${currentUser.votesRemaining}</div>
        <div class="stat-label">🎁 剩餘票數</div>
      </div>
      <div class="stat-item">
        <div class="stat-number">${currentUser.refreshesRemaining}</div>
        <div class="stat-label">🔄 刷新次數</div>
      </div>
    </div>
    <div id="votingArea"></div>
    <button onclick="window.refreshPair()">🔄 換一對</button>
    <button class="secondary-btn" onclick="window.backToLogin()">↩️ 登出</button>
  `;
  displayRandomPair();
}

// ✅ 新版本：加入獲勝者排除邏輯
function displayRandomPair() {
  const votingArea = document.getElementById('votingArea');

  if (currentUser.votesRemaining <= 0) {
    votingArea.innerHTML = '<div class="error">你的票數已用完！明天會自動恢復 5 票 🎁</div>';
    return;
  }

  if (submissions.length < 2) {
    votingArea.innerHTML = '<div class="error">作品數量不足，無法進行投票</div>';
    return;
  }

  // ✅ 過濾掉已投票獲勝的作品
  const votedWinners = currentUser.votedWinners || [];
  const availableSubmissions = submissions.filter(s => !votedWinners.includes(s.id));

  // ✅ 如果可用作品少於 2 個
  if (availableSubmissions.length < 2) {
    votingArea.innerHTML = '<div class="error">🎉 恭喜！你今天已經投票給所有作品了！<br>明天會自動重置，屆時可以再次投票 🎁</div>';
    return;
  }

  // ✅ 如果有當前顯示的配對，排除這兩個作品
  let excludeIds = [];
  if (currentDisplayPair) {
    excludeIds = [currentDisplayPair[0].id, currentDisplayPair[1].id];
  }

  const maxAttempts = 100;
  let pair;
  let attempts = 0;

  do {
    // ✅ 從可用作品中隨機選擇
    const shuffled = shuffleArray(availableSubmissions);
    
    // ✅ 過濾掉需要排除的作品
    const filtered = shuffled.filter(s => !excludeIds.includes(s.id));
    
    if (filtered.length < 2) {
      // 如果過濾後不足 2 個，清空排除列表重試
      excludeIds = [];
      continue;
    }
    
    pair = [filtered[0], filtered[1]];
    attempts++;

    if (attempts >= maxAttempts) {
      votingArea.innerHTML = '<div class="error">暫時找不到新的組合，請點擊「換一對」重試</div>';
      return;
    }
  } while (
    // ✅ 確保不是已投票的組合
    currentUser.votedPairs.includes(`${pair[0].id}-${pair[1].id}`) ||
    currentUser.votedPairs.includes(`${pair[1].id}-${pair[0].id}`)
  );

  // ✅ 隨機決定左右位置
  if (Math.random() < 0.5) {
    [pair[0], pair[1]] = [pair[1], pair[0]];
  }

  // ✅ 記錄當前顯示的配對
  currentDisplayPair = pair;

  votingArea.innerHTML = `
    <div class="images-container">
      <div class="image-option" onclick="window.showVoteConfirm('${pair[0].id}', '${pair[1].id}', '${pair[0].imageUrl}')">
        <img src="${pair[0].imageUrl}" alt="作品">
      </div>
      <div class="image-option" onclick="window.showVoteConfirm('${pair[1].id}', '${pair[0].id}', '${pair[1].imageUrl}')">
        <img src="${pair[1].imageUrl}" alt="作品">
      </div>
    </div>
  `;
}

function showError(message) {
  const app = document.getElementById('app');
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error';
  errorDiv.textContent = message;
  app.insertBefore(errorDiv, app.firstChild);
  setTimeout(() => errorDiv.remove(), 5000);
}

function showSuccess(message) {
  const app = document.getElementById('app');
  const successDiv = document.createElement('div');
  successDiv.className = 'success';
  successDiv.textContent = message;
  app.insertBefore(successDiv, app.firstChild);
  setTimeout(() => successDiv.remove(), 3000);
}

function showModal(className, content, autoClose) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `<div class="${className}">${content}</div>`;
  document.body.appendChild(modal);
  if (autoClose) {
    setTimeout(() => {
      modal.remove();
    }, autoClose);
  }
}

// ========== Window Functions ==========

window.toggleCollapse = function(sectionId) {
  const content = document.getElementById(`${sectionId}-content`);
  const icon = document.getElementById(`${sectionId}-icon`);
  if (content.classList.contains('open')) {
    content.classList.remove('open');
    icon.classList.remove('open');
  } else {
    content.classList.add('open');
    icon.classList.add('open');
  }
};

window.manualResetAllUsers = async function() {
  if (!confirm('⚠️ 確定要立即重置所有用戶嗎？\n\n此操作將：\n• 恢復所有人的票數至 5 票\n• 恢復所有人的刷新次數至 15 次\n• 清空所有人的投票記錄（允許重新投票給相同組合）\n• 清空獲勝作品記錄（所有作品重新可見）\n\n此操作無法復原！')) return;
  if (!confirm('再次確認：真的要立即重置所有用戶嗎？')) return;

  try {
    showSuccess('正在重置所有用戶...');
    const usersSnapshot = await getDocs(collection(db, 'users'));
    const updatePromises = [];

    for (const userDoc of usersSnapshot.docs) {
      updatePromises.push(
        updateDoc(doc(db, 'users', userDoc.id), {
          votesRemaining: 5,
          refreshesRemaining: 15,
          votedPairs: [],
          votedWinners: []  // ✅ 清空獲勝作品記錄
        })
      );
    }

    await Promise.all(updatePromises);
    showSuccess(`成功重置 ${usersSnapshot.size} 位用戶！`);
    setTimeout(() => showAdminPanel(), 2000);
  } catch (error) {
    console.error('重置失敗:', error);
    showError('重置失敗：' + error.message);
  }
};

window.showVoteConfirm = function(winId, loseId, imageUrl) {
  showModal('modal-overlay', `
    <div class="confirm-modal">
      <h2>確定投票？</h2>
      <img src="${imageUrl}" class="confirm-image" alt="作品">
      <div class="confirm-text">確定要投給這個作品嗎？<br>投票後將無法更改！</div>
      <div class="confirm-buttons">
        <button class="secondary-btn" onclick="window.closeModal()">❌ 取消</button>
        <button onclick="window.confirmVote('${winId}', '${loseId}')">✅ 確定投票</button>
      </div>
    </div>
  `);
};

window.closeModal = function() {
  const modal = document.querySelector('.modal-overlay');
  if (modal) modal.remove();
};

// ✅ 修改：投票後記錄獲勝作品
window.confirmVote = async function(winId, loseId) {
  window.closeModal();

  if (!isVotingAllowed()) {
    showError('投票時間已結束');
    showLoginPage();
    return;
  }

  try {
    const timestamp = Date.now();
    const voteRecord = {
      voter: currentUser.name,
      timestamp: timestamp,
      date: new Date(timestamp).toLocaleString('zh-TW')
    };

    await updateDoc(doc(db, 'submissions', winId), {
      score: increment(1),
      votes: arrayUnion(voteRecord)
    });

    currentUser.votesRemaining--;
    currentUser.votedPairs.push(`${winId}-${loseId}`);
    
    // ✅ 記錄獲勝作品
    if (!currentUser.votedWinners) {
      currentUser.votedWinners = [];
    }
    currentUser.votedWinners.push(winId);

    await updateDoc(doc(db, 'users', currentUser.name), {
      votesRemaining: currentUser.votesRemaining,
      votedPairs: currentUser.votedPairs,
      votedWinners: currentUser.votedWinners  // ✅ 儲存獲勝作品記錄
    });

    // ✅ 清空當前顯示的配對
    currentDisplayPair = null;

    showModal('modal-overlay', `
      <div class="success-modal">
        <h2>投票成功！</h2>
        <div class="success-icon"></div>
        <div class="success-message">🎉 你的投票已成功送出！<br>剩餘票數：${currentUser.votesRemaining}</div>
        <button onclick="window.closeModalAndRefresh()">繼續投票</button>
      </div>
    `, 3000);

    setTimeout(() => showVotingPage(), 3000);
  } catch (error) {
    console.error('投票失敗:', error);
    showError('投票失敗，請重試');
  }
};

window.closeModalAndRefresh = function() {
  window.closeModal();
  showVotingPage();
};

window.userLogin = async function() {
  if (!isVotingAllowed()) {
    showError('目前不在投票時間內');
    return;
  }

  const userName = document.getElementById('userName').value.trim();
  if (!userName) {
    showError('請輸入姓名');
    return;
  }

  try {
    const userDoc = await getDoc(doc(db, 'users', userName));
    if (userDoc.exists()) {
      currentUser = userDoc.data();
      // ✅ 確保 votedWinners 存在
      if (!currentUser.votedWinners) {
        currentUser.votedWinners = [];
      }
    } else {
      currentUser = {
        name: userName,
        votesRemaining: settings.maxVotes,
        refreshesRemaining: settings.maxRefreshes,
        votedPairs: [],
        votedWinners: []  // ✅ 初始化獲勝作品記錄
      };
      await setDoc(doc(db, 'users', userName), currentUser);
    }
    showVotingPage();
  } catch (error) {
    console.error('登入失敗:', error);
    showError('登入失敗，請重試');
  }
};

window.showAdminLogin = function() {
  document.getElementById('app').innerHTML = `
    <h1>🎄 後台管理登入 🎅</h1>
    <div class="input-group">
      <label>Email</label>
      <input type="email" id="adminEmail" placeholder="輸入管理員 Email">
    </div>
    <div class="input-group">
      <label>密碼</label>
      <input type="password" id="adminPassword" placeholder="輸入密碼">
    </div>
    <button onclick="window.adminLogin()">🎁 登入</button>
    <button class="secondary-btn" onclick="window.backToLogin()">↩️ 返回</button>
  `;
};

window.adminLogin = async function() {
  const email = document.getElementById('adminEmail').value.trim();
  const password = document.getElementById('adminPassword').value;

  if (!email || !password) {
    showError('請輸入 Email 和密碼');
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error('登入失敗:', error);
    if (error.code === 'auth/invalid-credential') {
      showError('Email 或密碼錯誤');
    } else {
      showError('登入失敗：' + error.message);
    }
  }
};

window.adminLogout = async function() {
  try {
    await signOut(auth);
    showLoginPage();
  } catch (error) {
    showError('登出失敗');
  }
};

// ✅ 修改：刷新時清空當前顯示配對
window.refreshPair = async function() {
  if (currentUser.refreshesRemaining <= 0) {
    showError('刷新次數已用完！明天會自動恢復 🔄');
    return;
  }

  try {
    currentUser.refreshesRemaining--;
    await updateDoc(doc(db, 'users', currentUser.name), {
      refreshesRemaining: currentUser.refreshesRemaining
    });
    
    // ✅ 清空當前顯示的配對（這樣下次就不會出現這兩個作品）
    currentDisplayPair = null;
    
    showVotingPage();
  } catch (error) {
    showError('刷新失敗');
  }
};

window.deleteVote = async function(submissionId, voteRecord) {
  if (!confirm(`確定要刪除 ${voteRecord.voter} 的投票嗎？`)) return;

  try {
    await updateDoc(doc(db, 'submissions', submissionId), {
      votes: arrayRemove(voteRecord),
      score: increment(-1)
    });
    showSuccess('投票記錄已刪除！');
    setTimeout(() => showAdminPanel(), 1000);
  } catch (error) {
    console.error('刪除投票失敗:', error);
    showError('刪除投票失敗');
  }
};

window.updateVotingTime = async function() {
  try {
    const startTime = document.getElementById('startTimeInput').value;
    const endTime = document.getElementById('endTimeInput').value;

    if (startTime && endTime && new Date(startTime) >= new Date(endTime)) {
      showError('結束時間必須晚於開始時間');
      return;
    }

    await updateDoc(doc(db, 'settings', 'config'), {
      votingStartTime: startTime || null,
      votingEndTime: endTime || null
    });

    settings.votingStartTime = startTime || null;
    settings.votingEndTime = endTime || null;

    showSuccess('投票時間更新成功！');
    setTimeout(() => showAdminPanel(), 1000);
  } catch (error) {
    showError('更新時間失敗');
  }
};

window.clearVotingTime = async function() {
  if (!confirm('確定要清除時間限制嗎？')) return;

  try {
    await updateDoc(doc(db, 'settings', 'config'), {
      votingStartTime: null,
      votingEndTime: null
    });

    settings.votingStartTime = null;
    settings.votingEndTime = null;

    showSuccess('時間限制已清除！');
    setTimeout(() => showAdminPanel(), 1000);
  } catch (error) {
    showError('清除時間失敗');
  }
};

window.toggleLeaderboardImages = async function() {
  try {
    settings.showLeaderboardImages = !settings.showLeaderboardImages;
    await updateDoc(doc(db, 'settings', 'config'), {
      showLeaderboardImages: settings.showLeaderboardImages
    });
    showSuccess(settings.showLeaderboardImages ? '已開啟排行榜圖片顯示' : '已關閉排行榜圖片顯示');
    setTimeout(() => showAdminPanel(), 1000);
  } catch (error) {
    console.error('更新設定失敗:', error);
    showError('更新設定失敗');
  }
};

window.saveGitHubToken = function() {
  const token = document.getElementById('githubTokenInput').value.trim();
  if (!token) {
    showError('請輸入 GitHub Token');
    return;
  }

  if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
    showError('Token 格式不正確');
    return;
  }

  localStorage.setItem('githubToken', token);
  githubToken = token;
  showSuccess('Token 儲存成功！');
  setTimeout(() => showAdminPanel(), 1000);
};

window.clearGitHubToken = function() {
  if (!confirm('確定要清除 GitHub Token 嗎？')) return;
  
  localStorage.removeItem('githubToken');
  githubToken = '';
  showSuccess('Token 已清除');
  setTimeout(() => showAdminPanel(), 1000);
};

window.previewImage = function(event) {
  const selectedFile = event.target.files[0];
  if (selectedFile) {
    const fileSizeMB = (selectedFile.size / 1024 / 1024).toFixed(2);
    const sizeDisplay = document.getElementById('fileSizeDisplay');
    sizeDisplay.textContent = `檔案大小：${fileSizeMB} MB`;
    
    if (selectedFile.size > 2 * 1024 * 1024) {
      sizeDisplay.style.color = '#c62828';
      sizeDisplay.textContent += ' ⚠️ 建議小於 2 MB';
    } else {
      sizeDisplay.style.color = '#2e7d32';
      sizeDisplay.textContent += ' ✓';
    }
    
    const previewReader = new FileReader();
    previewReader.onload = function(e) {
      const preview = document.getElementById('imagePreview');
      preview.src = e.target.result;
      preview.classList.remove('hidden');
    };
    previewReader.readAsDataURL(selectedFile);
  }
};

window.updateTheme = async function() {
  const theme = document.getElementById('themeInput').value.trim();
  if (!theme) {
    showError('請輸入主題');
    return;
  }

  try {
    await updateDoc(doc(db, 'settings', 'config'), {
      theme: theme
    });
    settings.theme = theme;
    showSuccess('主題更新成功！');
    setTimeout(() => showAdminPanel(), 1000);
  } catch (error) {
    console.error('更新主題失敗:', error);
    showError('更新主題失敗');
  }
};

window.uploadSubmission = async function() {
  const title = document.getElementById('submissionTitle').value.trim();
  const fileInput = document.getElementById('submissionImage');
  const file = fileInput.files[0];

  if (!title || !file) {
    showError('請填寫標題並選擇圖片');
    return;
  }

  if (!githubToken) {
    showError('請先設定 GitHub Token');
    return;
  }

  try {
    const uploadBtn = document.getElementById('uploadBtn');
    const progressBar = document.getElementById('uploadProgress');
    const progressFill = document.getElementById('uploadProgressFill');

    uploadBtn.disabled = true;
    progressBar.classList.remove('hidden');
    progressFill.style.width = '30%';
    progressFill.textContent = '上傳中...';

    const imageData = await uploadImageToGitHub(file);

    progressFill.style.width = '70%';
    progressFill.textContent = '儲存資料...';

    const timestamp = Date.now();
    await setDoc(doc(db, 'submissions', `submission_${timestamp}`), {
      title: title,
      imageUrl: imageData.url,
      imagePath: imageData.path,
      score: 0,
      votes: [],
      createdAt: timestamp
    });

    progressFill.style.width = '100%';
    progressFill.textContent = '完成！';

    showSuccess('上傳成功！');
    setTimeout(() => showAdminPanel(), 1500);
  } catch (error) {
    console.error('上傳失敗:', error);
    showError('上傳失敗：' + error.message);
    document.getElementById('uploadBtn').disabled = false;
    document.getElementById('uploadProgress').classList.add('hidden');
  }
};

window.deleteSubmission = async function(submissionId, imagePath) {
  if (!confirm('確定要刪除這個作品嗎？')) return;

  try {
    if (imagePath) {
      await deleteImageFromGitHub(imagePath);
    }
    await deleteDoc(doc(db, 'submissions', submissionId));
    showSuccess('刪除成功！');
    setTimeout(() => showAdminPanel(), 1000);
  } catch (error) {
    console.error('刪除失敗:', error);
    showError('刪除失敗');
  }
};

window.updateLeaderboard = async function() {
  try {
    showSuccess('正在更新排行榜...');
    const q = query(collection(db, 'submissions'), orderBy('score', 'desc'));
    const querySnapshot = await getDocs(q);
    const leaderboardData = querySnapshot.docs.map((doc, index) => ({
      rank: index + 1,
      ...doc.data()
    }));

    await setDoc(doc(db, 'settings', 'leaderboard'), {
      data: leaderboardData,
      updatedAt: Date.now()
    });

    showSuccess(`排行榜更新成功！共 ${leaderboardData.length} 位參賽者`);
  } catch (error) {
    console.error('更新排行榜失敗:', error);
    showError('更新排行榜失敗');
  }
};

window.showLeaderboard = async function() {
  try {
    const leaderboardDoc = await getDoc(doc(db, 'settings', 'leaderboard'));
    const app = document.getElementById('app');
    app.className = 'container leaderboard-container';

    if (!leaderboardDoc.exists() || !leaderboardDoc.data().data) {
      app.innerHTML = `
        <h1>🏆 排行榜 🎄</h1>
        <div class="error">暫無排行數據</div>
        <button class="secondary-btn" onclick="window.backToLogin()">↩️ 返回</button>
      `;
      return;
    }

    const leaderboardData = leaderboardDoc.data();
    const rankings = leaderboardData.data;
    const updatedAt = leaderboardData.updatedAt;
    const showImages = settings.showLeaderboardImages;

    const updateTimeStr = updatedAt 
      ? new Date(updatedAt).toLocaleString('zh-TW', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })
      : '未知';

    app.innerHTML = `
      <h1>🏆 排行榜 🎄</h1>
      <div class="leaderboard-notice">
        <div class="leaderboard-notice-title">非實時更新</div>
        <div class="leaderboard-notice-text">排行榜數據由管理員手動更新，<br>不會即時反映最新投票結果</div>
      </div>
      <div class="leaderboard-update-time">上次更新：${updateTimeStr}</div>
      <div class="leaderboard-update-time" style="background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); color: #2e7d32; border-color: #66bb6a;">
        共 ${rankings.length} 位參賽者
      </div>
      <div class="leaderboard-list">
        ${rankings.map(item => `
          <div class="leaderboard-item">
            <div class="rank">#${item.rank}</div>
            ${showImages ? `<img src="${item.imageUrl}" class="leaderboard-image" alt="${item.title}">` : ''}
            <div class="leaderboard-info">
              <div class="leaderboard-title">${item.title}</div>
              <div class="leaderboard-score">⭐ 得分: ${item.score || 0}</div>
            </div>
          </div>
        `).join('')}
      </div>
      <button class="secondary-btn" onclick="window.backToLogin()">↩️ 返回</button>
    `;
  } catch (error) {
    showError('載入排行榜失敗');
  }
};

window.backToLogin = function() {
  currentUser = null;
  currentDisplayPair = null;  // ✅ 清空當前顯示配對
  showLoginPage();
};

// ========== 初始化 ==========
init();
