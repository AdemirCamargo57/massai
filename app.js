const firebaseConfig = {
  apiKey: "AIzaSyAAEnhVKuq8DlYbksSWUApujmhmfZ02Xb4",
  authDomain: "sapucaia-gado-2026.firebaseapp.com",
  projectId: "sapucaia-gado-2026",
  storageBucket: "sapucaia-gado-2026.firebasestorage.app",
  messagingSenderId: "738874315348",
  appId: "1:738874315348:web:b5b539c57dee2e7cbdd3c1"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();
storage.setMaxUploadRetryTime(10000); // Reduzido para 10 segundos para acionar o fallback offline rapidamente

// ATIVAR PERSISTÊNCIA OFFLINE
db.enablePersistence()
  .catch((err) => {
      if (err.code == 'failed-precondition') {
          console.warn('Múltiplas abas abertas, persistência ativada apenas em uma.');
      } else if (err.code == 'unimplemented') {
          console.warn('O navegador não suporta persistência offline.');
      }
  });

// Constantes de Categorias
const CATEGORIES = [
  { id: 'f_0_4', name: 'Fêmeas de 0-4 meses', sex: 'f' },
  { id: 'm_0_4', name: 'Machos de 0-4 meses', sex: 'm' },
  { id: 'f_4_12', name: 'Fêmeas de 4-12 meses', sex: 'f' },
  { id: 'm_4_12', name: 'Machos de 4-12 meses', sex: 'm' },
  { id: 'f_12_24', name: 'Fêmeas de 12-24 meses', sex: 'f' },
  { id: 'm_12_24', name: 'Machos de 12-24 meses', sex: 'm' },
  { id: 'f_24_36', name: 'Fêmeas de 24-36 meses', sex: 'f' },
  { id: 'm_24_36', name: 'Machos de 24-36 meses', sex: 'm' },
  { id: 'f_36_plus', name: 'Fêmeas com + 36 meses', sex: 'f' },
  { id: 'm_36_plus', name: 'Machos com + 36 meses', sex: 'm' }
];

// Dados Iniciais (Mock Database)
const INITIAL_DATA = {
  users: [
    { id: 1, name: 'Admin', password: 'admin', role: 'admin' }
  ],
  farms: [],
  pastures: [],
  // Inventário: chave é `${pastureId}_${categoryId}` -> quantidade
  cattleInventory: {},
  // Detalhes do pasto: chave é `${pastureId}` -> { notes: '', photos: [] }
  pastureDetails: {},
  // Histórico de Movimentações
  movements: []
};

// Application State
const app = {
  data: null,
  currentUser: null,
  currentFarmId: null,
  currentPastureId: null,
  photoDocCache: {},

  init() {
    this.cacheDOM();
    this.bindEvents();
    this.listenPhotoDocuments();
    
    const btnLogin = this.loginForm.querySelector('button');
    const originalText = btnLogin.textContent;
    btnLogin.textContent = "Conectando...";
    btnLogin.disabled = true;

    db.collection('fazenda').doc('state').onSnapshot((doc) => {
      const isFirstLoad = !this.data;
      
      if (doc.exists) {
        this.data = doc.data();
        try {
          localStorage.setItem('gadoData', JSON.stringify(this.data));
        } catch (err) {
          console.warn("Nao foi possivel salvar no armazenamento local", err);
        }
      } else {
        if (doc.metadata && !doc.metadata.fromCache) {
          // Confirmado pelo servidor online que o documento nao existe (primeira inicializacao)
          console.log("Inicializando banco de dados com INITIAL_DATA (Online)...");
          this.data = JSON.parse(JSON.stringify(INITIAL_DATA));
          this.saveData();
        } else {
          // Cache offline vazio ou nao carregado ainda. Carrega do localStorage para nao quebrar a UI
          console.log("Documento nao encontrado no cache local. Carregando do localStorage...");
          const saved = localStorage.getItem('gadoData');
          if (saved) {
            this.data = JSON.parse(saved);
          } else {
            this.data = JSON.parse(JSON.stringify(INITIAL_DATA));
          }
          // IMPORTANTE: Nao chama saveData() aqui para nao sobrescrever o servidor ao reconectar!
        }
      }

      if (isFirstLoad) {
        btnLogin.textContent = originalText;
        btnLogin.disabled = false;
        this.checkAuth();
      } else {
        this.refreshCurrentView();
      }
    }, (error) => {
      console.error("Erro Firebase:", error);
      if(!this.data) {
        const saved = localStorage.getItem('gadoData');
        this.data = saved ? JSON.parse(saved) : JSON.parse(JSON.stringify(INITIAL_DATA));
        btnLogin.textContent = originalText;
        btnLogin.disabled = false;
        this.checkAuth();
      }
    });
  },

  refreshCurrentView() {
    if (!this.currentUser) return;
    if (!this.views.admin.classList.contains('hidden')) {
      this.renderAdminDashboard();
    } else if (!this.views.parceiro.classList.contains('hidden')) {
      if (!this.parceiroCounters.classList.contains('hidden')) {
        this.renderCounters();
        if (document.activeElement !== this.pastureNotes) {
          this.loadPastureDetails();
        }
      } else {
        this.populateFarmsDropdown();
        if(this.currentFarmId) {
          this.selectFarm.value = this.currentFarmId;
          this.selectPasture.disabled = false;
          this.selectPasture.innerHTML = '<option value="">Selecione o Pasto...</option>';
          this.data.pastures.filter(p => p.farmId === this.currentFarmId).forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            this.selectPasture.appendChild(opt);
          });
          this.selectPasture.value = this.currentPastureId || '';
        }
      }
    } else if (!this.views.report.classList.contains('hidden')) {
      this.renderReport();
    }
  },

  saveData() {
    if (this.data) {
      try {
        localStorage.setItem('gadoData', JSON.stringify(this.data));
      } catch (err) {
        console.warn("Nao foi possivel salvar no armazenamento local", err);
      }
      return db.collection('fazenda').doc('state').set(this.data)
        .then(() => true)
        .catch(err => {
          console.error("Erro ao salvar", err);
          return false;
        });
    }
    return Promise.resolve(false);
  },

  // Atualiza apenas a chave específica do inventário no Firestore, sem sobrescrever o documento inteiro.
  // Evita que o registro de um vaqueiro apague o registro de outro em operações concorrentes.
  saveCattleUpdate(key, newValue, movement) {
    try {
      localStorage.setItem('gadoData', JSON.stringify(this.data));
    } catch (err) {
      console.warn("Nao foi possivel salvar no armazenamento local", err);
    }

    const updatePayload = {};
    updatePayload[`cattleInventory.${key}`] = newValue;
    if (movement) {
      updatePayload['movements'] = firebase.firestore.FieldValue.arrayUnion(movement);
    }

    return db.collection('fazenda').doc('state').update(updatePayload)
      .then(() => true)
      .catch(err => {
        console.error("Erro ao salvar contagem de gado", err);
        return false;
      });
  },

  listenPhotoDocuments() {
    db.collection('pasturePhotos').onSnapshot((snapshot) => {
      this.photoDocCache = {};
      snapshot.forEach((doc) => {
        this.photoDocCache[doc.id] = doc.data();
      });

      if (this.data && this.currentUser) {
        this.refreshCurrentView();
      }
    }, (error) => {
      console.warn("Nao foi possivel carregar fotos salvas no Firestore", error);
    });
  },

  cacheDOM() {
    this.views = {
      login: document.getElementById('login-view'),
      admin: document.getElementById('admin-view'),
      parceiro: document.getElementById('parceiro-view'),
      report: document.getElementById('report-view'),
      history: document.getElementById('history-view')
    };
    
    // Login
    this.loginForm = document.getElementById('login-form');
    this.passwordInput = document.getElementById('password');
    this.btnTogglePassword = document.getElementById('btn-toggle-password');
    this.loginError = document.getElementById('login-error');
    
    // Admin
    this.adminTotalGado = document.getElementById('admin-total-gado');
    this.adminTotalFazendas = document.getElementById('admin-total-fazendas');
    this.adminFarmsList = document.getElementById('admin-farms-list');
    
    // Admin Parceiros
    this.addParceiroForm = document.getElementById('add-parceiro-form');
    this.newParceiroName = document.getElementById('new-parceiro-name');
    this.newParceiroPassword = document.getElementById('new-parceiro-password');
    this.adminParceirosList = document.getElementById('admin-parceiros-list');
    
    // Admin Fazendas/Pastos
    this.addFarmForm = document.getElementById('add-farm-form');
    this.newFarmName = document.getElementById('new-farm-name');
    this.adminFarmsManagementList = document.getElementById('admin-farms-management-list');
    
    // Parceiro Context
    this.selectFarm = document.getElementById('select-farm');
    this.selectPasture = document.getElementById('select-pasture');
    this.btnLoadPasture = document.getElementById('btn-load-pasture');
    this.parceiroContext = document.getElementById('parceiro-context-selection');
    this.parceiroCounters = document.getElementById('parceiro-counters');
    this.currentPastureName = document.getElementById('current-pasture-name');
    this.categoriesContainer = document.getElementById('categories-container');
    this.parceiroName = document.getElementById('parceiro-name');
    
    // Pasture Details
    this.pastureNotes = document.getElementById('pasture-notes');
    this.pasturePhotosContainer = document.getElementById('pasture-photos-container');
    
    // History View
    this.historyView = document.getElementById('history-view');
    this.historyViewTitle = document.getElementById('history-view-title');
    this.historyViewContent = document.getElementById('history-view-content');
    this.btnClearHistory = document.getElementById('btn-clear-history');
    
    // Report
    this.reportContent = document.getElementById('report-content');
    
    // Modal
    this.photoModal = document.getElementById('photo-modal');
    this.photoModalImg = document.getElementById('photo-modal-img');
  },

  bindEvents() {
    this.loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    if (this.btnTogglePassword) {
      this.btnTogglePassword.addEventListener('click', () => this.togglePasswordVisibility());
    }
    this.selectFarm.addEventListener('change', (e) => this.handleFarmChange(e));
    this.selectPasture.addEventListener('change', (e) => {
      this.currentPastureId = e.target.value;
      this.btnLoadPasture.disabled = !this.currentPastureId;
    });
    this.btnLoadPasture.addEventListener('click', () => this.loadPastureCounters());
    
    if (this.addParceiroForm) {
      this.addParceiroForm.addEventListener('submit', (e) => this.handleAddParceiro(e));
    }
    if (this.addFarmForm) {
      this.addFarmForm.addEventListener('submit', (e) => this.handleAddFarm(e));
    }
    
    // Configurar botão de Instalação (PWA)
    this.setupPWAInstall();
  },

  setupPWAInstall() {
    let deferredPrompt;
    const btnInstallApp = document.getElementById('btn-install-app');

    window.addEventListener('beforeinstallprompt', (e) => {
      // Impede que o Chrome mostre o prompt automaticamente
      e.preventDefault();
      // Guarda o evento para ser disparado pelo botão
      deferredPrompt = e;
      // Mostra o botão na tela
      if (btnInstallApp) {
        btnInstallApp.classList.remove('hidden');
      }
    });

    if (btnInstallApp) {
      btnInstallApp.addEventListener('click', async () => {
        if (deferredPrompt) {
          // Mostra o prompt nativo de instalação
          deferredPrompt.prompt();
          // Espera o usuário responder
          const { outcome } = await deferredPrompt.userChoice;
          console.log(`Resultado da instalação: ${outcome}`);
          // Reseta o prompt
          deferredPrompt = null;
          // Esconde o botão após a interação
          btnInstallApp.classList.add('hidden');
        }
      });
    }
  },

  togglePasswordVisibility() {
    if (!this.passwordInput || !this.btnTogglePassword) return;
    if (this.passwordInput.type === 'password') {
      this.passwordInput.type = 'text';
      this.btnTogglePassword.textContent = '🙈';
    } else {
      this.passwordInput.type = 'password';
      this.btnTogglePassword.textContent = '👁️';
    }
  },

  // Navigation & Auth
  showView(viewName) {
    Object.values(this.views).forEach(v => v.classList.add('hidden'));
    this.views[viewName].classList.remove('hidden');
  },

  checkAuth() {
    const savedUserId = sessionStorage.getItem('loggedUserId');
    if (savedUserId) {
      const user = this.data.users.find(u => u.id == savedUserId);
      if (user) {
        this.currentUser = user;
        this.routeUser();
        return;
      }
    }
    this.showView('login');
  },

  handleLogin(e) {
    e.preventDefault();
    const pass = this.passwordInput.value;
    const user = this.data.users.find(u => u.password === pass);
    
    if (user) {
      this.currentUser = user;
      sessionStorage.setItem('loggedUserId', user.id);
      this.loginError.classList.add('hidden');
      this.passwordInput.value = '';
      this.routeUser();
    } else {
      this.loginError.textContent = 'Senha incorreta.';
      this.loginError.classList.remove('hidden');
    }
  },

  logout() {
    this.currentUser = null;
    sessionStorage.removeItem('loggedUserId');
    if (this.backupsListenerUnsubscribe) {
      this.backupsListenerUnsubscribe();
      this.backupsListenerUnsubscribe = null;
    }
    this.showView('login');
  },

  async forceAppUpdate() {
    document.querySelectorAll('.btn-force-update').forEach(btn => {
      btn.disabled = true;
      btn.textContent = 'Atualizando...';
    });
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(r => r.unregister()));
      }
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }
    } catch (err) {
      console.warn('Erro ao limpar cache:', err);
    }
    window.location.reload();
  },

  changeMyPassword() {
    if (!this.currentUser) return;
    const currentPass = prompt("Digite sua senha atual:");
    if (currentPass === null) return;
    if (currentPass !== this.currentUser.password) {
      alert("Senha atual incorreta.");
      return;
    }
    const newPass = prompt("Digite a nova senha:");
    if (newPass === null || newPass.trim() === '') return;
    
    const userInDb = this.data.users.find(u => u.id === this.currentUser.id);
    if (userInDb) {
      userInDb.password = newPass.trim();
      this.currentUser.password = newPass.trim();
      this.saveData();
      alert("Senha alterada com sucesso.");
    }
  },

  routeUser() {
    if (this.currentUser.role === 'admin') {
      this.renderAdminDashboard();
      this.showView('admin');
      this.listenBackups();
    } else {
      this.parceiroName.textContent = this.currentUser.name;
      this.populateFarmsDropdown();
      this.resetParceiroContext();
      this.showView('parceiro');
      if (this.backupsListenerUnsubscribe) {
        this.backupsListenerUnsubscribe();
        this.backupsListenerUnsubscribe = null;
      }
    }
  },

  // Admin Dashboard Logic
  renderAdminDashboard() {
    this.adminTotalFazendas.textContent = this.data.farms.length;
    
    let totalCattle = 0;
    this.adminFarmsList.innerHTML = '';

    this.data.farms.forEach(farm => {
      // Calcular gado por fazenda
      const farmPastures = this.data.pastures.filter(p => p.farmId === farm.id);
      let farmTotalCattle = 0;
      
      farmPastures.forEach(pasture => {
        CATEGORIES.forEach(cat => {
          const key = `${pasture.id}_${cat.id}`;
          farmTotalCattle += (this.data.cattleInventory[key] || 0);
        });
      });
      totalCattle += farmTotalCattle;

      const div = document.createElement('div');
      div.className = 'category-item';
      div.innerHTML = `
        <div class="category-info">
          <div class="category-name">${farm.name}</div>
          <div class="category-badge" style="background: rgba(255,255,255,0.1); color: #fff;">${farmPastures.length} Pastos</div>
        </div>
        <div class="count-display" style="color: var(--primary);">${farmTotalCattle}</div>
      `;
      this.adminFarmsList.appendChild(div);
    });

    this.adminTotalGado.textContent = totalCattle;
    this.renderParceirosList();
    this.renderFarmsCheckboxes();
    this.renderFarmsManagementList();
  },

  renderParceirosList() {
    if (!this.adminParceirosList) return;
    this.adminParceirosList.innerHTML = '';
    const parceiros = this.data.users.filter(u => u.role === 'parceiro');
    
    parceiros.forEach(parceiro => {
      const linkedFarmsNames = (parceiro.linkedFarms || []).map(id => {
        const f = this.data.farms.find(f => f.id === id);
        return f ? f.name : '';
      }).filter(n => n).join(', ') || 'Nenhuma fazenda';

      const div = document.createElement('div');
      div.className = 'category-item';
      div.style.flexDirection = 'column';
      div.style.alignItems = 'stretch';
      
      let checkboxesHtml = '';
      this.data.farms.forEach(farm => {
        const checked = (parceiro.linkedFarms || []).includes(farm.id) ? 'checked' : '';
        checkboxesHtml += `
          <label class="checkbox-label" style="display:block; font-size: 0.9rem; margin-bottom: 0.25rem;">
            <input type="checkbox" value="${farm.id}" class="edit-farm-checkbox-${parceiro.id}" ${checked}>
            ${farm.name}
          </label>
        `;
      });

      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
          <div class="category-info">
            <div class="category-name">${parceiro.name}</div>
            <div class="category-badge" style="background: rgba(255,255,255,0.1); color: #B3B3B3; margin-bottom: 0.25rem;">Senha: ${parceiro.password}</div>
            <div style="font-size: 0.8rem; color: var(--text-secondary);">Fazendas: ${linkedFarmsNames}</div>
          </div>
          <div class="counter-controls">
            <button class="btn btn-secondary" onclick="app.toggleEditParceiro(${parceiro.id})" style="padding:0.25rem 0.5rem; font-size:0.8rem; width:auto;">Editar</button>
            <button class="btn-circle btn-minus" onclick="app.removeParceiro(${parceiro.id})" title="Remover Parceiro" style="width:30px; height:30px; font-size:1.2rem;">-</button>
          </div>
        </div>
        <div id="edit-parceiro-${parceiro.id}" class="hidden" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--surface-border);">
          <div class="form-group mb-2">
            <label>Nome:</label>
            <input type="text" id="edit-parceiro-name-${parceiro.id}" value="${parceiro.name}" style="width:100%; padding: 0.5rem; border-radius: 4px; border: 1px solid var(--surface-border); background: rgba(0,0,0,0.2); color: white;">
          </div>
          <div class="form-group mb-2">
            <label>Senha:</label>
            <input type="text" id="edit-parceiro-password-${parceiro.id}" value="${parceiro.password}" style="width:100%; padding: 0.5rem; border-radius: 4px; border: 1px solid var(--surface-border); background: rgba(0,0,0,0.2); color: white;">
          </div>
          <div class="form-group mb-2">
            <label style="display:block; margin-bottom:0.5rem;">Fazendas Vinculadas:</label>
            <div style="background: rgba(0,0,0,0.2); padding: 0.5rem; border-radius: 4px; border: 1px solid var(--surface-border);">
              ${checkboxesHtml}
            </div>
          </div>
          <div style="display:flex; gap:0.5rem; margin-top: 1rem;">
            <button class="btn btn-primary" onclick="app.saveEditParceiro(${parceiro.id})" style="padding: 0.5rem 1rem; width:auto;">Salvar</button>
            <button class="btn btn-secondary" onclick="app.toggleEditParceiro(${parceiro.id})" style="padding: 0.5rem 1rem; width:auto;">Cancelar</button>
          </div>
        </div>
      `;
      this.adminParceirosList.appendChild(div);
    });
  },

  renderFarmsCheckboxes() {
    const container = document.getElementById('new-parceiro-farms');
    if (!container) return;
    container.innerHTML = '';
    this.data.farms.forEach(farm => {
      const label = document.createElement('label');
      label.className = 'checkbox-label';
      label.innerHTML = `
        <input type="checkbox" value="${farm.id}" class="farm-checkbox">
        ${farm.name}
      `;
      container.appendChild(label);
    });
  },

  handleAddParceiro(e) {
    e.preventDefault();
    const name = this.newParceiroName.value.trim();
    const password = this.newParceiroPassword.value.trim();
    
    const checkboxes = document.querySelectorAll('.farm-checkbox:checked');
    const linkedFarms = Array.from(checkboxes).map(cb => parseInt(cb.value));
    
    if (name && password) {
      if (this.data.users.find(u => u.password === password)) {
        alert('Esta senha já está em uso. Por favor, escolha outra.');
        return;
      }

      this.data.users.push({
        id: Date.now(),
        name: name,
        password: password,
        role: 'parceiro',
        linkedFarms: linkedFarms
      });
      
      this.saveData();
      this.renderParceirosList();
      
      this.newParceiroName.value = '';
      this.newParceiroPassword.value = '';
      Array.from(document.querySelectorAll('.farm-checkbox')).forEach(cb => cb.checked = false);
    }
  },

  removeParceiro(id) {
    if (confirm('Deseja realmente remover o acesso deste parceiro?')) {
      this.data.users = this.data.users.filter(u => u.id !== id);
      this.saveData();
      this.renderParceirosList();
    }
  },

  toggleEditParceiro(id) {
    const editDiv = document.getElementById(`edit-parceiro-${id}`);
    if (editDiv) {
      editDiv.classList.toggle('hidden');
    }
  },

  saveEditParceiro(id) {
    const parceiro = this.data.users.find(u => u.id === id);
    if (!parceiro) return;
    
    const nameInput = document.getElementById(`edit-parceiro-name-${id}`);
    const passwordInput = document.getElementById(`edit-parceiro-password-${id}`);
    const checkboxes = document.querySelectorAll(`.edit-farm-checkbox-${id}:checked`);
    
    const newName = nameInput.value.trim();
    const newPassword = passwordInput.value.trim();
    const linkedFarms = Array.from(checkboxes).map(cb => parseInt(cb.value));

    if (newName && newPassword) {
      parceiro.name = newName;
      parceiro.password = newPassword;
      parceiro.linkedFarms = linkedFarms;
      this.saveData();
      this.renderParceirosList();
    } else {
      alert("Nome e senha são obrigatórios.");
    }
  },

  renderFarmsManagementList() {
    if (!this.adminFarmsManagementList) return;
    this.adminFarmsManagementList.innerHTML = '';
    
    this.data.farms.forEach(farm => {
      const farmPastures = this.data.pastures.filter(p => p.farmId === farm.id);
      
      const div = document.createElement('div');
      div.className = 'glass-card mb-3';
      div.style.padding = '1rem';
      div.style.background = 'rgba(0,0,0,0.4)';
      
      let html = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 1rem;">
          <h4 style="color:var(--primary); font-size:1.2rem;">${farm.name}</h4>
          <button class="btn-circle btn-minus" onclick="app.removeFarm(${farm.id})" title="Remover Fazenda" style="width:30px; height:30px; font-size:1.2rem;">-</button>
        </div>
        <div class="category-list" style="margin-bottom: 1rem;">
      `;
      
      farmPastures.forEach(pasture => {
        html += `
          <div class="category-item" style="padding: 0.5rem; display:flex; align-items:center;">
            <div class="category-info">
              <div class="category-name" style="font-size:0.9rem;">${pasture.name}</div>
            </div>
            <div class="counter-controls">
              <button class="btn btn-secondary" onclick="app.renamePasturePrompt(${pasture.id})" style="padding:0.25rem 0.5rem; font-size:0.8rem; width:auto;">Renomear</button>
              <button class="btn-circle btn-minus" onclick="app.removePasture(${pasture.id})" title="Remover Pasto" style="width:25px; height:25px; font-size:1rem;">-</button>
            </div>
          </div>
        `;
      });
      
      html += `
        </div>
        <button class="btn btn-secondary" onclick="app.addPasturePrompt(${farm.id})" style="padding: 0.5rem; font-size: 0.9rem;">+ Adicionar Pasto</button>
      `;
      
      div.innerHTML = html;
      this.adminFarmsManagementList.appendChild(div);
    });
  },

  handleAddFarm(e) {
    e.preventDefault();
    const name = this.newFarmName.value.trim();
    if (name) {
      this.data.farms.push({
        id: Date.now(),
        name: name
      });
      this.saveData();
      this.newFarmName.value = '';
      this.renderAdminDashboard();
    }
  },

  removeFarm(id) {
    if (confirm('Atenção: Remover esta fazenda também removerá todos os seus pastos. Deseja continuar?')) {
      this.data.farms = this.data.farms.filter(f => f.id !== id);
      this.data.pastures = this.data.pastures.filter(p => p.farmId !== id);
      this.saveData();
      this.renderAdminDashboard();
    }
  },

  addPasturePrompt(farmId) {
    const name = prompt('Nome do novo pasto:');
    if (name && name.trim()) {
      this.data.pastures.push({
        id: Date.now(),
        farmId: farmId,
        name: name.trim()
      });
      this.saveData();
      this.renderAdminDashboard();
    }
  },

  renamePasturePrompt(pastureId) {
    const pasture = this.data.pastures.find(p => p.id === pastureId);
    if (!pasture) return;
    const newName = prompt('Novo nome para o pasto:', pasture.name);
    if (newName && newName.trim()) {
      pasture.name = newName.trim();
      this.saveData();
      this.renderAdminDashboard();
    }
  },

  removePasture(pastureId) {
    if (confirm('Deseja realmente remover este pasto? (O inventário associado não será exibido mais)')) {
      this.data.pastures = this.data.pastures.filter(p => p.id !== pastureId);
      this.saveData();
      this.renderAdminDashboard();
    }
  },

  // Parceiro Logic
  populateFarmsDropdown() {
    this.selectFarm.innerHTML = '<option value="">Selecione a Fazenda...</option>';
    let availableFarms = this.data.farms;
    
    if (this.currentUser && this.currentUser.role === 'parceiro' && this.currentUser.linkedFarms) {
      availableFarms = availableFarms.filter(f => this.currentUser.linkedFarms.includes(f.id));
    }

    availableFarms.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.name;
      this.selectFarm.appendChild(opt);
    });
  },

  handleFarmChange(e) {
    const farmId = parseInt(e.target.value);
    this.currentFarmId = farmId;
    this.selectPasture.innerHTML = '<option value="">Selecione o Pasto...</option>';
    this.currentPastureId = null;
    this.btnLoadPasture.disabled = true;

    if (farmId) {
      this.selectPasture.disabled = false;
      const pastures = this.data.pastures.filter(p => p.farmId === farmId);
      pastures.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        this.selectPasture.appendChild(opt);
      });
    } else {
      this.selectPasture.disabled = true;
    }
  },

  resetParceiroContext() {
    this.parceiroContext.classList.remove('hidden');
    this.parceiroCounters.classList.add('hidden');
    this.currentFarmId = null;
    this.currentPastureId = null;
    this.selectFarm.value = '';
    this.selectPasture.innerHTML = '<option value="">Primeiro selecione a fazenda...</option>';
    this.selectPasture.disabled = true;
    this.btnLoadPasture.disabled = true;
  },

  loadPastureCounters() {
    if (!this.currentPastureId) return;
    
    const pasture = this.data.pastures.find(p => p.id == this.currentPastureId);
    this.currentPastureName.textContent = pasture.name;
    
    this.parceiroContext.classList.add('hidden');
    this.parceiroCounters.classList.remove('hidden');
    
    this.renderCounters();
    this.loadPastureDetails();
  },

  renderCounters() {
    this.categoriesContainer.innerHTML = '';
    
    CATEGORIES.forEach(cat => {
      const key = `${this.currentPastureId}_${cat.id}`;
      const count = this.data.cattleInventory[key] || 0;
      
      const badgeClass = cat.sex === 'f' ? 'badge-femea' : 'badge-macho';
      const badgeText = cat.sex === 'f' ? 'Fêmea' : 'Macho';

      const div = document.createElement('div');
      div.className = 'category-item';
      div.innerHTML = `
        <div class="category-info">
          <div class="category-name">${cat.name}</div>
          <span class="category-badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="counter-controls">
          <button class="btn-circle btn-minus" onclick="app.updateCount('${key}', -1)">-</button>
          <input type="number" class="count-display count-input" value="${count}" onchange="app.setCount('${key}', this.value)" min="0" />
          <button class="btn-circle btn-plus" onclick="app.updateCount('${key}', 1)">+</button>
        </div>
      `;
      this.categoriesContainer.appendChild(div);
    });
  },

  updateCount(key, change) {
    const current = this.data.cattleInventory[key] || 0;
    let newValue = current + change;
    if (newValue < 0) newValue = 0; // Não permitir negativo

    const movement = this.saveMovement(key, current, newValue);
    this.data.cattleInventory[key] = newValue;
    this.saveCattleUpdate(key, newValue, movement);
    this.renderCounters(); // Re-render para atualizar os números na tela
  },

  setCount(key, value) {
    let newValue = parseInt(value, 10);
    if (isNaN(newValue) || newValue < 0) newValue = 0;

    const current = this.data.cattleInventory[key] || 0;
    const movement = this.saveMovement(key, current, newValue);
    this.data.cattleInventory[key] = newValue;
    this.saveCattleUpdate(key, newValue, movement);
    this.renderCounters();
  },

  saveMovement(key, previousValue, newValue) {
    if (previousValue === newValue) return null;
    if (!this.data.movements) this.data.movements = [];

    const firstUnderscore = key.indexOf('_');
    const pId = parseInt(key.substring(0, firstUnderscore));
    const cId = key.substring(firstUnderscore + 1);

    const movement = {
      id: Date.now(),
      pastureId: pId,
      categoryId: cId,
      userId: this.currentUser ? this.currentUser.id : null,
      userName: this.currentUser ? this.currentUser.name : 'Desconhecido',
      timestamp: new Date().toISOString(),
      previousCount: previousValue,
      newCount: newValue,
      change: newValue - previousValue
    };
    this.data.movements.push(movement);
    return movement;
  },

  // --- PASTURE DETAILS (NOTES E PHOTOS) ---
  loadPastureDetails() {
    if (!this.currentPastureId) return;
    const details = this.data.pastureDetails[this.currentPastureId] || { notes: '', photos: [] };
    
    if(this.pastureNotes) this.pastureNotes.value = details.notes || '';
    this.setPhotoUploadStatus('');
    this.renderPasturePhotos(details.photos || []);
  },

  savePastureDetails() {
    if (!this.currentPastureId) return;
    
    if (!this.data.pastureDetails[this.currentPastureId]) {
      this.data.pastureDetails[this.currentPastureId] = { notes: '', photos: [] };
    }
    
    if(this.pastureNotes) this.data.pastureDetails[this.currentPastureId].notes = this.pastureNotes.value.trim();
    this.saveData();
  },

  setPhotoUploadStatus(message, isError = false) {
    if (!this.pasturePhotosContainer) return;

    const existing = document.getElementById('photo-upload-status');
    if (existing) existing.remove();

    if (!message) return;

    const status = document.createElement('div');
    status.id = 'photo-upload-status';
    status.style.width = '100%';
    status.style.fontSize = '0.9rem';
    status.style.color = isError ? 'var(--danger)' : 'var(--primary)';
    status.style.marginTop = '0.5rem';
    status.textContent = message;
    this.pasturePhotosContainer.before(status);
  },

  getPhotoUrl(photo) {
    if (!photo) return '';
    if (typeof photo === 'string') return photo;

    if (photo.url || photo.downloadURL) {
      return photo.url || photo.downloadURL;
    }

    if (photo.firestorePhotoId && this.photoDocCache[photo.firestorePhotoId]) {
      return this.photoDocCache[photo.firestorePhotoId].dataUrl || '';
    }

    return '';
  },

  getPhotoPath(photo) {
    return photo && typeof photo === 'object' ? photo.path : '';
  },

  getFirestorePhotoId(photo) {
    return photo && typeof photo === 'object' ? photo.firestorePhotoId : '';
  },

  ensurePasturePhotoStore(pastureId) {
    if (!this.data.pastureDetails[pastureId]) {
      this.data.pastureDetails[pastureId] = { notes: '', photos: [] };
    }
    if (!Array.isArray(this.data.pastureDetails[pastureId].photos)) {
      this.data.pastureDetails[pastureId].photos = [];
    }
    return this.data.pastureDetails[pastureId].photos;
  },

  createCompressedPhotoBlob(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Nao foi possivel ler a foto selecionada.'));
      reader.onload = (event) => {
        const img = new Image();
        img.onerror = () => reject(new Error('Nao foi possivel processar a imagem.'));
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 640;
          const MAX_HEIGHT = 640;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }

          canvas.width = Math.round(width);
          canvas.height = Math.round(height);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Nao foi possivel compactar a foto.'));
              return;
            }
            resolve(blob);
          }, 'image/jpeg', 0.6);
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  },

  blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Nao foi possivel salvar a foto compactada.'));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  },

  describeUploadError(error) {
    if (!error) return '';
    const code = error.code ? `${error.code}: ` : '';
    return `${code}${error.message || error}`;
  },

  async savePhotoDocument(pastureId, dataUrl) {
    const docRef = db.collection('pasturePhotos').doc();
    const photoData = {
      pastureId,
      dataUrl,
      createdAt: new Date().toISOString(),
      uploadedBy: this.currentUser ? this.currentUser.id : null,
      uploadedByName: this.currentUser ? this.currentUser.name : 'Desconhecido'
    };

    await docRef.set(photoData);
    this.photoDocCache[docRef.id] = photoData;
    return docRef.id;
  },

  async handlePhotoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!this.currentPastureId) {
      e.target.value = '';
      return;
    }

    const pastureId = String(this.currentPastureId);
    const photos = this.ensurePasturePhotoStore(pastureId);

    if (photos.length >= 3) {
      alert('Limite de 3 fotos por pasto atingido. Exclua uma antes de enviar outra.');
      e.target.value = '';
      return;
    }

    e.target.disabled = true;
    this.setPhotoUploadStatus('Enviando foto...');

    let blob;

    try {
      blob = await this.createCompressedPhotoBlob(file);
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const path = `pasture-photos/${pastureId}/${fileName}`;
      const ref = storage.ref().child(path);
      const snapshot = await ref.put(blob, {
        contentType: 'image/jpeg',
        customMetadata: {
          pastureId,
          uploadedBy: this.currentUser ? String(this.currentUser.id) : ''
        }
      });
      const url = await snapshot.ref.getDownloadURL();

      const photoRecord = {
        url,
        path,
        uploadedAt: new Date().toISOString(),
        uploadedBy: this.currentUser ? this.currentUser.id : null,
        uploadedByName: this.currentUser ? this.currentUser.name : 'Desconhecido'
      };
      photos.push(photoRecord);

      const saved = await this.saveData();
      if (!saved) {
        photos.pop();
        await this.deleteStoredPhoto(photoRecord);
        throw new Error('A foto foi enviada, mas o link nao foi salvo no banco de dados.');
      }

      this.renderPasturePhotos(photos);
      this.setPhotoUploadStatus('Foto enviada com sucesso.');
    } catch (error) {
      console.error('Erro ao enviar foto:', error);
      const detail = this.describeUploadError(error);

      try {
        if (!blob) {
          throw error;
        }

        const fallbackUrl = await this.blobToDataUrl(blob);
        const firestorePhotoId = await this.savePhotoDocument(pastureId, fallbackUrl);
        photos.push({
          firestorePhotoId,
          storageMode: 'firestore-doc',
          uploadedAt: new Date().toISOString(),
          uploadedBy: this.currentUser ? this.currentUser.id : null,
          uploadedByName: this.currentUser ? this.currentUser.name : 'Desconhecido'
        });

        const saved = await this.saveData();
        if (!saved) {
          photos.pop();
          await db.collection('pasturePhotos').doc(firestorePhotoId).delete().catch(err => console.warn('Nao foi possivel remover foto temporaria', err));
          throw new Error('Nao foi possivel salvar a foto no banco de dados.');
        }

        this.renderPasturePhotos(photos);
        this.setPhotoUploadStatus('Foto salva (modo offline).');
      } catch (fallbackError) {
        console.error('Erro ao salvar foto em modo compatibilidade:', fallbackError);
        const fallbackDetail = this.describeUploadError(fallbackError);
        this.setPhotoUploadStatus(`Erro ao enviar foto. ${fallbackDetail}`, true);
        alert(`Nao foi possivel enviar a foto. Detalhe: ${fallbackDetail}`);
      }
    } finally {
      e.target.disabled = false;
      e.target.value = '';
    }
  },

  async deleteStoredPhoto(photo) {
    const path = this.getPhotoPath(photo);
    const firestorePhotoId = this.getFirestorePhotoId(photo);

    if (firestorePhotoId) {
      try {
        await db.collection('pasturePhotos').doc(firestorePhotoId).delete();
        delete this.photoDocCache[firestorePhotoId];
      } catch (error) {
        console.warn('Nao foi possivel excluir a foto do Firestore:', error);
      }
    }

    if (!path) return;

    try {
      await storage.ref().child(path).delete();
    } catch (error) {
      console.warn('Nao foi possivel excluir a foto do Storage:', error);
    }
  },

  async removePhoto(index) {
    if (!this.currentPastureId) return;
    if (confirm('Deseja excluir esta foto?')) {
      const photos = this.ensurePasturePhotoStore(String(this.currentPastureId));
      const [removedPhoto] = photos.splice(index, 1);
      await this.deleteStoredPhoto(removedPhoto);
      this.saveData();
      this.renderPasturePhotos(photos);
    }
  },

  async removePhotoAdmin(pastureId, index) {
    if (!this.currentUser || this.currentUser.role !== 'admin') return;
    if (confirm('Deseja excluir esta foto?')) {
      const photos = this.ensurePasturePhotoStore(String(pastureId));
      const [removedPhoto] = photos.splice(index, 1);
      await this.deleteStoredPhoto(removedPhoto);
      this.saveData();
      this.renderReport();
    }
  },

  renderPasturePhotos(photos) {
    if(!this.pasturePhotosContainer) return;
    this.pasturePhotosContainer.innerHTML = '';
    photos.forEach((photo, index) => {
      const photoUrl = this.getPhotoUrl(photo);
      if (!photoUrl) return;

      const div = document.createElement('div');
      div.style.position = 'relative';
      div.style.width = '100px';
      div.style.height = '100px';
      div.style.borderRadius = '8px';
      div.style.overflow = 'hidden';
      div.style.border = '1px solid var(--surface-border)';

      div.innerHTML = `
        <img src="${photoUrl}" style="width:100%; height:100%; object-fit:cover; cursor:pointer;" onclick="app.openPhotoModal(this.src)" title="Abrir foto">
        <button class="btn-circle btn-minus" style="position:absolute; top:2px; right:2px; width:24px; height:24px; font-size:1rem;" onclick="app.removePhoto(${index})">-</button>
      `;
      this.pasturePhotosContainer.appendChild(div);
    });
  },

  // --- REPORT LOGIC ---
  showReport() {
    this.renderReport();
    this.showView('report');
  },

  renderReport() {
    if(!this.reportContent) return;
    this.reportContent.innerHTML = '';
    
    let visibleFarms = this.data.farms;
    if (this.currentUser && this.currentUser.role === 'parceiro') {
      const linked = this.currentUser.linkedFarms || [];
      visibleFarms = visibleFarms.filter(f => linked.includes(f.id));
    }

    if (visibleFarms.length === 0) {
      this.reportContent.innerHTML = '<p class="text-center">Nenhuma fazenda disponível para visualização.</p>';
      return;
    }

    let totalGeral = 0;

    visibleFarms.forEach(farm => {
      const farmDiv = document.createElement('div');
      farmDiv.className = 'glass-card mb-4';
      farmDiv.style.padding = '1.5rem';
      
      const farmPastures = this.data.pastures.filter(p => p.farmId === farm.id);
      
      let farmTotalCattle = 0;
      let farmCategoryTotals = {};
      let html = `<h3 class="mb-3" style="color:var(--primary); font-size: 1.5rem;">${farm.name}</h3>`;
      
      if (farmPastures.length === 0) {
        html += '<p>Nenhum pasto cadastrado nesta fazenda.</p>';
      } else {
        let pasturesHtml = `<div style="display:flex; flex-direction:column; gap:1rem;">`;
        
        farmPastures.forEach(pasture => {
          let pastureTotalCattle = 0;
          let countsHtml = '';
          
          CATEGORIES.forEach(cat => {
            const key = `${pasture.id}_${cat.id}`;
            const count = this.data.cattleInventory[key] || 0;
            if (count > 0) {
              pastureTotalCattle += count;
              farmCategoryTotals[cat.id] = (farmCategoryTotals[cat.id] || 0) + count;
              countsHtml += `
                <div style="display:flex; justify-content:space-between; margin-bottom:0.25rem; font-size:0.9rem;">
                  <span>${cat.name}</span>
                  <strong>${count}</strong>
                </div>
              `;
            }
          });
          
          farmTotalCattle += pastureTotalCattle;
          
          const details = this.data.pastureDetails[pasture.id] || { notes: '', photos: [] };
          let notesHtml = '';
          if (details.notes) {
            notesHtml = `<div style="margin-top:0.5rem; padding:0.5rem; background:rgba(0,0,0,0.3); border-radius:4px; font-size:0.9rem;"><strong>Notas:</strong> ${details.notes}</div>`;
          }
          
          let photosHtml = '';
          if (details.photos && details.photos.length > 0) {
            photosHtml = `<div style="display:flex; gap:0.5rem; margin-top:0.5rem; flex-wrap:wrap;">`;
            details.photos.forEach((p, index) => {
              const photoUrl = this.getPhotoUrl(p);
              if (!photoUrl) return;

              if (this.currentUser && this.currentUser.role === 'admin') {
                photosHtml += `
                  <div style="position:relative; width:60px; height:60px;">
                    <img src="${photoUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:4px; border:1px solid rgba(255,255,255,0.2); cursor:pointer;" onclick="app.openPhotoModal(this.src)" title="Abrir foto">
                    <button class="btn-circle btn-minus" style="position:absolute; top:-5px; right:-5px; width:20px; height:20px; font-size:0.8rem; line-height:1; display:flex; justify-content:center; align-items:center; background:var(--danger);" onclick="app.removePhotoAdmin(${pasture.id}, ${index})" title="Excluir Foto">x</button>
                  </div>
                `;
              } else {
                photosHtml += `<img src="${photoUrl}" style="width:60px; height:60px; object-fit:cover; border-radius:4px; border:1px solid rgba(255,255,255,0.2); cursor:pointer;" onclick="app.openPhotoModal(this.src)" title="Abrir foto">`;
              }
            });
            photosHtml += `</div>`;
          }

          pasturesHtml += `
            <div style="border:1px solid var(--surface-border); border-radius:8px; padding:1rem; background:rgba(255,255,255,0.05);">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                <h4 style="font-size:1.1rem; display:flex; align-items:center; gap:0.5rem;">
                  ${pasture.name}
                  <button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.8rem; width:auto;" onclick="app.openPastureHistory(${pasture.id})">Ver Histórico</button>
                </h4>
                <span class="category-badge" style="background:var(--primary); color:#111;">${pastureTotalCattle} Animais</span>
              </div>
              <div style="margin-bottom:0.5rem;">
                ${countsHtml || '<p style="font-size:0.9rem; color:var(--text-secondary);">Nenhum animal registrado.</p>'}
              </div>
              ${notesHtml}
              ${photosHtml}
            </div>
          `;
        });
        
        pasturesHtml += `</div>`;
        
        let farmSummaryHtml = '';
        if (farmTotalCattle > 0) {
          farmSummaryHtml += `<div style="background: rgba(0,0,0,0.2); padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; border: 1px solid var(--primary);">`;
          farmSummaryHtml += `<h4 style="margin-bottom: 0.75rem; color: var(--primary); text-align: center; font-size: 1.1rem;">Total por Idade na Fazenda</h4>`;
          CATEGORIES.forEach(cat => {
            const count = farmCategoryTotals[cat.id] || 0;
            if (count > 0) {
              farmSummaryHtml += `
                <div style="display:flex; justify-content:space-between; margin-bottom:0.25rem; font-size:0.95rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.25rem;">
                  <span>${cat.name}</span>
                  <strong>${count}</strong>
                </div>
              `;
            }
          });
          farmSummaryHtml += `</div>`;
        }
        
        html += farmSummaryHtml + pasturesHtml;
      }
      
      html = html.replace('</h3>', ` - <span style="font-size:1.2rem; color:white;">Total: ${farmTotalCattle} cabeças</span></h3>`);
      
      farmDiv.innerHTML = html;
      this.reportContent.appendChild(farmDiv);
      totalGeral += farmTotalCattle;
    });
    
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'glass-card mb-4 text-center';
    summaryDiv.innerHTML = `
      <h3 style="font-size:2rem; color:var(--primary); margin-bottom:0.5rem;">${totalGeral}</h3>
      <p style="text-transform:uppercase; letter-spacing:1px; font-size:0.9rem;">Total Geral de Animais</p>
    `;
    this.reportContent.insertBefore(summaryDiv, this.reportContent.firstChild);
  },

  openPastureHistory(pastureId) {
    const pasture = this.data.pastures.find(p => p.id === pastureId);
    if (!pasture) return;

    this.historyViewTitle.textContent = `${pasture.name}`;
    this.historyViewContent.innerHTML = '';

    const movements = (this.data.movements || []).filter(m => m.pastureId === pastureId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (this.currentUser && this.currentUser.role === 'admin' && movements.length > 0) {
      this.btnClearHistory.classList.remove('hidden');
      this.btnClearHistory.onclick = () => this.clearPastureHistory(pastureId);
    } else {
      if(this.btnClearHistory) this.btnClearHistory.classList.add('hidden');
    }

    if (movements.length === 0) {
      this.historyViewContent.innerHTML = '<p class="text-center" style="margin-top:2rem;">Nenhuma movimentação registrada para este pasto.</p>';
    } else {
      let html = '';
      movements.forEach(m => {
        const cat = CATEGORIES.find(c => c.id === m.categoryId);
        const catName = cat ? cat.name : m.categoryId;
        const dateStr = new Date(m.timestamp).toLocaleString('pt-BR');
        const changeStr = m.change > 0 ? `+${m.change}` : `${m.change}`;
        const changeColor = m.change > 0 ? 'var(--primary)' : 'var(--danger)';

        html += `
          <div class="category-item glass-card" style="display:block; padding:1.5rem; margin-bottom: 1rem;">
            <div style="display:flex; justify-content:space-between; margin-bottom:0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.5rem;">
              <span style="font-size:0.9rem; color:var(--text-secondary);">${dateStr}</span>
              <span style="font-size:1.1rem; font-weight:bold; color:${changeColor};">${changeStr}</span>
            </div>
            <div style="font-size:1.1rem; margin-bottom:0.25rem;">
              <strong>${catName}</strong>: ${m.previousCount} &rarr; ${m.newCount}
            </div>
            <div style="font-size:0.95rem; color:var(--text-secondary);">
              Usuário: ${m.userName}
            </div>
          </div>
        `;
      });
      this.historyViewContent.innerHTML = html;
    }

    this.showView('history');
  },

  closePastureHistory() {
    this.showView('report');
  },

  clearPastureHistory(pastureId) {
    if (!this.currentUser || this.currentUser.role !== 'admin') return;
    if (confirm('Tem certeza que deseja limpar todo o histórico de movimentações deste pasto? Esta ação não pode ser desfeita.')) {
      this.data.movements = (this.data.movements || []).filter(m => m.pastureId !== pastureId);
      this.saveData();
      this.openPastureHistory(pastureId); // Reloads the empty view
    }
  },

  openPhotoModal(url) {
    if(!this.photoModal || !this.photoModalImg) return;
    this.photoModalImg.src = url;
    this.photoModal.classList.remove('hidden');
  },

  closePhotoModal() {
    if(!this.photoModal || !this.photoModalImg) return;
    this.photoModal.classList.add('hidden');
    this.photoModalImg.src = '';
  },

  exportBackup() {
    if (!this.data) {
      alert("Nenhum dado disponível para exportar.");
      return;
    }
    try {
      const dataStr = JSON.stringify(this.data, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const dateStr = new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
      const filename = `sapucaia_backup_${dateStr}.json`;
      
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Erro ao exportar backup:", err);
      alert("Erro ao exportar backup: " + err.message);
    }
  },

  importBackup(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onerror = () => alert("Erro ao ler o arquivo selecionado.");
    reader.onload = async (e) => {
      try {
        const importedData = JSON.parse(e.target.result);
        
        // Validação básica do backup
        if (!importedData.users || !importedData.farms || !importedData.pastures) {
          throw new Error("Formato de backup inválido. Chaves obrigatórias ausentes.");
        }
        
        const confirmRestore = confirm(
          `Deseja realmente restaurar este backup?\n\n` +
          `Resumo dos dados importados:\n` +
          `- Fazendas: ${importedData.farms.length}\n` +
          `- Pastos: ${importedData.pastures.length}\n` +
          `- Usuários/Parceiros: ${importedData.users.length}\n` +
          `- Lançamentos no Inventário: ${Object.keys(importedData.cattleInventory || {}).length}\n\n` +
          `ATENÇÃO: Todos os dados atuais do Firestore serão substituídos!`
        );
        
        if (confirmRestore) {
          this.data = importedData;
          const success = await this.saveData();
          if (success) {
            alert("Backup importado e salvo no Firestore com sucesso!");
            this.renderAdminDashboard();
          } else {
            alert("Erro ao salvar os dados importados no Firestore. Tente novamente.");
          }
        }
      } catch (err) {
        alert("Erro ao processar arquivo de backup: " + err.message);
      } finally {
        event.target.value = ''; // Limpa o input
      }
    };
    reader.readAsText(file);
  },

  async createCloudBackup() {
    if (!this.data) {
      alert("Nenhum dado disponível para backup.");
      return;
    }
    
    const desc = prompt("Digite uma descrição curta para este backup:", `Backup manual em ${new Date().toLocaleDateString('pt-BR')}`);
    if (desc === null) return; // Cancelou
    
    try {
      const backupData = {
        createdAt: new Date().toISOString(),
        description: desc.trim() || 'Backup manual',
        createdBy: this.currentUser ? this.currentUser.name : 'Admin',
        data: this.data
      };
      
      await db.collection('backups').add(backupData);
      alert("Backup em nuvem criado com sucesso!");
    } catch (err) {
      console.error("Erro ao criar backup em nuvem:", err);
      alert("Erro ao salvar backup na nuvem. Verifique a conexão e as regras do Firestore.");
    }
  },

  async restoreCloudBackupPrompt(backupId) {
    try {
      const doc = await db.collection('backups').doc(backupId).get();
      if (!doc.exists) {
        alert("Backup não encontrado.");
        return;
      }
      
      const backup = doc.data();
      const confirmRestore = confirm(
        `Restaurar o backup "${backup.description}"?\n` +
        `Criado em: ${new Date(backup.createdAt).toLocaleString('pt-BR')}\n` +
        `Por: ${backup.createdBy}\n\n` +
        `ATENÇÃO: Isso irá substituir TODOS os dados atuais do sistema!`
      );
      
      if (confirmRestore) {
        this.data = backup.data;
        const success = await this.saveData();
        if (success) {
          alert("Backup restaurado e salvo com sucesso!");
          this.renderAdminDashboard();
        } else {
          alert("Erro ao salvar os dados restaurados.");
        }
      }
    } catch (err) {
      console.error("Erro ao restaurar backup:", err);
      alert("Erro ao restaurar backup: " + err.message);
    }
  },

  async deleteCloudBackupPrompt(backupId) {
    if (confirm("Tem certeza de que deseja excluir este backup permanentemente da nuvem?")) {
      try {
        await db.collection('backups').doc(backupId).delete();
        alert("Backup excluído com sucesso.");
      } catch (err) {
        console.error("Erro ao excluir backup:", err);
        alert("Erro ao excluir backup: " + err.message);
      }
    }
  },

  listenBackups() {
    if (!this.currentUser || this.currentUser.role !== 'admin') return;
    
    if (this.backupsListenerUnsubscribe) {
      this.backupsListenerUnsubscribe();
    }
    
    const container = document.getElementById('admin-backups-list');
    if (!container) return;
    
    this.backupsListenerUnsubscribe = db.collection('backups')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .onSnapshot((snapshot) => {
        container.innerHTML = '';
        if (snapshot.empty) {
          container.innerHTML = '<p class="text-center" style="font-size:0.9rem; color:var(--text-secondary); padding: 1rem 0;">Nenhum backup em nuvem encontrado.</p>';
          return;
        }
        
        snapshot.forEach((doc) => {
          const backup = doc.data();
          const id = doc.id;
          const dateStr = new Date(backup.createdAt).toLocaleString('pt-BR');
          const desc = backup.description || 'Sem descrição';
          const author = backup.createdBy || 'Sistema';
          const sizeInfo = backup.data ? `${backup.data.farms ? backup.data.farms.length : 0} fazendas, ${backup.data.pastures ? backup.data.pastures.length : 0} pastos` : 'Dados corrompidos';
          
          const div = document.createElement('div');
          div.className = 'category-item';
          div.style.flexDirection = 'row';
          div.style.justifyContent = 'space-between';
          div.style.alignItems = 'center';
          div.style.padding = '0.75rem 1rem';
          div.innerHTML = `
            <div class="category-info" style="text-align: left;">
              <div class="category-name" style="font-size:0.95rem; font-weight:600; margin-bottom: 0.15rem;">${desc}</div>
              <div style="font-size:0.8rem; color:var(--text-secondary);">${dateStr} | Por: ${author}</div>
              <div style="font-size:0.75rem; color:var(--primary); font-weight:500; margin-top: 0.15rem;">${sizeInfo}</div>
            </div>
            <div style="display:flex; gap:0.4rem; align-items: center; flex-shrink: 0;">
              <button class="btn btn-primary" onclick="app.restoreCloudBackupPrompt('${id}')" style="padding:0.4rem 0.75rem; font-size:0.8rem; width:auto; height:32px; font-weight:600;">Restaurar</button>
              <button class="btn-circle btn-minus" onclick="app.deleteCloudBackupPrompt('${id}')" title="Excluir Backup" style="width:32px; height:32px; font-size:1.1rem; line-height: 1;">-</button>
            </div>
          `;
          container.appendChild(div);
        });
      }, (error) => {
        console.warn("Erro ao ouvir backups:", error);
        container.innerHTML = '<p class="text-center" style="color: var(--danger); font-size:0.9rem; padding: 1rem 0;">Não foi possível carregar backups (verifique a conexão e as regras do Firestore).</p>';
      });
  }
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
