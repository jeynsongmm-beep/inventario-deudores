document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('loginForm')) {
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      const errorEl = document.getElementById('loginError');
      if (!username || !password) { errorEl.textContent = 'Completa todos los campos'; return; }
      const res = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.success) { window.location.href = '/'; }
      else { errorEl.textContent = data.error || 'Error al iniciar sesión'; }
    });
    return;
  }

  fetch('/api/me').then(res => res.json()).then(data => {
    if (!data.authenticated) { window.location.href = '/login'; return; }
    const headerContent = document.querySelector('.header-content');
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'logout-btn';
    logoutBtn.textContent = 'Cerrar sesión';
    logoutBtn.onclick = async () => {
      await fetch('/api/logout', { method: 'POST' });
      window.location.href = '/login';
    };
    headerContent.appendChild(logoutBtn);
  });

  window.debtorStatusFilter = 'all';
  const darkToggle = document.getElementById('darkToggle');
  if (darkToggle) {
    const isDark = localStorage.getItem('darkMode') === 'true';
    if (isDark) document.body.classList.add('dark-mode');
    darkToggle.textContent = isDark ? '☀' : '☾';
    darkToggle.addEventListener('click', () => {
      const on = document.body.classList.toggle('dark-mode');
      localStorage.setItem('darkMode', on);
      darkToggle.textContent = on ? '☀' : '☾';
    });
  }

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'debtors') refreshProductSearch();
    });
  });

  document.getElementById('filterBar').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    window.debtorStatusFilter = btn.dataset.filter;
    loadDebtors();
  });

  loadDebtors();
  loadInventory();
  initProductSearch();

  document.getElementById('debtorForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('debtorName').value.trim();
    const amount = document.getElementById('debtorAmount').value;
    const dueDate = document.getElementById('debtorDueDate').value;
    const rate = document.getElementById('debtorRate').value;
    const products = getSelectedProducts();
    if (!name || !amount) return;
    await fetch('/api/debtors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, amount, rate, products, dueDate })
    });
    document.getElementById('debtorForm').reset();
    document.getElementById('selectedProducts').innerHTML = '';
    document.getElementById('productSearch').value = '';
    document.getElementById('multiTotal').textContent = '$0.00';
    document.getElementById('productDropdown').style.display = 'none';
    selectedItems.length = 0;
    amountManuallySet = false;
    loadDebtors();
    loadInventory();
    refreshProductSearch();
    showToast('Deudor registrado correctamente');
  });

  document.getElementById('inventoryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('itemName').value.trim();
    const quantity = document.getElementById('itemQuantity').value;
    const price = document.getElementById('itemPrice').value || 0;
    if (!name || !quantity) return;
    await fetch('/api/inventory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, quantity, price })
    });
    document.getElementById('inventoryForm').reset();
    loadInventory();
    refreshProductSearch();
    showToast('Producto agregado al inventario');
  });

  const searchInput = document.getElementById('debtorSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      window.debtorFilter = searchInput.value;
      loadDebtors();
    });
  }
});

const selectedItems = [];
let amountManuallySet = false;

function getSelectedProducts() {
  return selectedItems.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity }));
}

async function loadDebtors() {
  const res = await fetch('/api/debtors?_=' + Date.now());
  let debtors = await res.json();
  const nameFilter = (window.debtorFilter || '').toLowerCase();
  if (nameFilter) {
    debtors = debtors.filter(d => d.name.toLowerCase().includes(nameFilter));
  }
  const statusFilter = window.debtorStatusFilter || 'all';
  if (statusFilter !== 'all') {
    const today = new Date();
    debtors = debtors.filter(d => {
      if (statusFilter === 'paid') return d.amount <= 0;
      if (statusFilter === 'pending') return d.amount > 0;
      if (statusFilter === 'overdue') return d.dueDate && new Date(d.dueDate) < today && d.amount > 0;
      return true;
    });
  }
  debtors.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const container = document.getElementById('debtorList');
  if (!container) return;
  if (debtors.length === 0) {
    container.innerHTML = '<div class="empty">No hay deudores registrados</div>';
    return;
  }
  const pending = debtors.filter(d => d.amount > 0);
  const paid = debtors.filter(d => d.amount <= 0);
  const today = new Date();
  let html = '';
  if (pending.length > 0) {
    html += '<div class="section-label">Pendientes</div>';
    html += pending.map(d => {
    const isOverdue = d.dueDate && new Date(d.dueDate) < today && d.amount > 0;
    const dueSoon = d.dueDate && !isOverdue && (new Date(d.dueDate) - today) / 86400000 <= 3 && d.amount > 0;
     return `<div class="debtor-card ${isOverdue ? 'overdue' : ''} ${d.amount <= 0 ? 'paid-off' : ''}">
       <div class="debtor-info">
         <span class="debtor-name">${esc(d.name)} <span class="debtor-rate">(${(d.rate || 1).toFixed(2)})</span></span>
          <span class="debtor-amount ${d.amount <= 0 ? 'paid' : ''}">$${d.amount.toFixed(2)} <span class="amount-bs">= Bs ${fmt(d.amount * (d.rate || 1))}</span></span>
        </div>
        ${d.dueDate ? `<div class="due-date ${isOverdue ? 'text-danger' : dueSoon ? 'text-warning' : ''}">Vence: ${new Date(d.dueDate).toLocaleDateString()}${isOverdue ? ' (VENCIDA)' : dueSoon ? ' (Pronto)' : ''}</div>` : ''}
        ${d.products && d.products.length > 0 ? `
          <div class="product-chips">
            ${d.products.map(p => `<span class="product-chip">${esc(p.name)} x${p.quantity} - $${(p.price * p.quantity).toFixed(2)}</span>`).join('')}
          </div>
        ` : ''}
        ${d.description ? `<div style="color:var(--text-secondary);font-size:0.85rem;margin-top:6px">${esc(d.description)}</div>` : ''}
        <div class="debtor-actions">
          <button class="btn-pay" onclick="showPayModal('${d.id}')">⊕ Abonar</button>
          <button class="btn-edit" onclick="editDebtor('${d.id}')">✎ Editar</button>
          <button class="btn-delete" onclick="deleteDebtor('${d.id}')">✕ Eliminar</button>
          <button class="btn-view" onclick="showPayHistory('${d.id}')">≡ Abonos</button>
          <button class="btn-rate" onclick="showRateModal('${d.id}')">💰 Tasa</button>
        </div>
      </div>`;
      }).join('');
    }
    if (paid.length > 0) {
      html += '<div class="section-label" style="margin-top:16px">Pagados</div>';
      html += paid.map(d => {
        return `<div class="debtor-card paid-off">
        <div class="debtor-info">
          <span class="debtor-name">${esc(d.name)} <span class="debtor-rate">(${(d.rate || 1).toFixed(2)})</span></span>
          <span class="debtor-amount paid">$${d.amount.toFixed(2)} <span class="amount-bs">= Bs ${fmt(d.amount * (d.rate || 1))}</span></span>
      </div>
      ${d.products && d.products.length > 0 ? `
        <div class="product-chips">
          ${d.products.map(p => `<span class="product-chip">${esc(p.name)} x${p.quantity} - $${(p.price * p.quantity).toFixed(2)}</span>`).join('')}
        </div>
      ` : ''}
      <div class="debtor-actions">
        <button class="btn-delete" onclick="deleteDebtor('${d.id}')">Eliminar</button>
        <button class="btn-view" onclick="showPayHistory('${d.id}')">Ver Abonos</button>
        <button class="btn-rate" onclick="showRateModal('${d.id}')">💰 Tasa</button>
      </div>
    </div>`;
    }).join('');
  }
  container.innerHTML = html;
}

let payingDebtorId = null;
let rateEditingDebtorId = null;

function showRateModal(id) {
  rateEditingDebtorId = id;
  fetch('/api/debtors').then(r => r.json()).then(debtors => {
    const d = debtors.find(x => x.id === id);
    if (!d) return;
    document.getElementById('rateModalDebtorName').textContent = d.name;
    document.getElementById('rateModalInput').value = d.rate || 1;
    document.getElementById('rateModal').style.display = 'flex';
    setTimeout(() => document.getElementById('rateModalInput').focus(), 100);
  });
}

function closeRateModal() {
  document.getElementById('rateModal').style.display = 'none';
  rateEditingDebtorId = null;
}
document.getElementById('rateModal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeRateModal(); });

document.getElementById('rateModalSaveBtn')?.addEventListener('click', async () => {
  if (!rateEditingDebtorId) return;
  const rate = parseFloat(document.getElementById('rateModalInput').value);
  if (!rate || rate <= 0) return;
  await fetch(`/api/debtors/${rateEditingDebtorId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rate })
  });
  closeRateModal();
  loadDebtors();
  showToast('Tasa actualizada');
});

function showPayModal(id) {
  payingDebtorId = id;
  document.getElementById('payAmount').value = '';
  document.getElementById('payNote').value = '';
  document.getElementById('payModal').style.display = 'flex';
  setTimeout(() => document.getElementById('payAmount').focus(), 100);
}

function closePayModal() {
  document.getElementById('payModal').style.display = 'none';
  payingDebtorId = null;
}
document.getElementById('payModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closePayModal(); });

document.getElementById('payConfirmBtn').addEventListener('click', async () => {
  if (!payingDebtorId) return;
  const amount = parseFloat(document.getElementById('payAmount').value);
  const note = document.getElementById('payNote').value.trim();
  if (!amount || amount <= 0) return;
  try {
    await fetch(`/api/debtors/${payingDebtorId}/pay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, note: note || '' })
    });
  } catch (e) {
    return;
  }
  closePayModal();
  await loadDebtors();
  showToast('Abono registrado correctamente');
});

let editingDebtorId = null;
const editSelectedItems = [];

async function updateEditUI() {
  const container = document.getElementById('editSelectedProducts');
  const multiTotal = document.getElementById('editMultiTotal');
  if (editSelectedItems.length === 0) {
    container.innerHTML = '';
    multiTotal.textContent = '$0.00';
    return;
  }
  let total = 0;
  container.innerHTML = editSelectedItems.map((item, idx) => {
    const subtotal = item.price * item.quantity;
    total += subtotal;
    return `<div class="selected-item">
      <div class="selected-item-info">
        <span class="selected-item-name">${esc(item.name)}</span>
        <span class="selected-item-price">$${item.price.toFixed(2)} c/u</span>
      </div>
      <div class="selected-item-controls">
        <input type="number" class="edit-item-qty" data-idx="${idx}" value="${item.quantity}" min="1">
        <span class="selected-item-subtotal">$${subtotal.toFixed(2)}</span>
        <button class="btn-remove" data-idx="${idx}">×</button>
      </div>
    </div>`;
  }).join('');
  multiTotal.textContent = '$' + total.toFixed(2);
  container.querySelectorAll('.edit-item-qty').forEach(inp => {
    inp.addEventListener('input', () => {
      editSelectedItems[parseInt(inp.dataset.idx)].quantity = parseInt(inp.value) || 1;
      updateEditUI();
      renderEditDropdown('');
    });
  });
  container.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      editSelectedItems.splice(parseInt(btn.dataset.idx), 1);
      updateEditUI();
      renderEditDropdown('');
    });
  });
}

function renderEditDropdown(filter) {
  const dropdown = document.getElementById('editProductDropdown');
  const filtered = (filter
    ? productSearchItems.filter(i => i.name.toLowerCase().includes(filter.toLowerCase()))
    : productSearchItems).filter(i => i.quantity > 0 && !editSelectedItems.some(s => s.id === i.id));
  if (filtered.length === 0) { dropdown.style.display = 'none'; return; }
  dropdown.innerHTML = filtered.map(i =>
    `<div class="dropdown-item" data-id="${i.id}" data-name="${esc(i.name)}" data-price="${i.price}">${esc(i.name)} <small>(${i.quantity} disp. ${i.price ? '- $' + i.price.toFixed(2) : ''})</small></div>`
  ).join('');
  dropdown.style.display = 'block';
}

async function editDebtor(id) {
  const [debtorsRes, invRes] = await Promise.all([fetch('/api/debtors'), fetch('/api/inventory?_=' + Date.now())]);
  const debtors = await debtorsRes.json();
  const d = debtors.find(x => x.id === id);
  if (!d) return;
  productSearchItems = await invRes.json();
  editingDebtorId = id;
  editSelectedItems.length = 0;
  document.getElementById('editDebtorName').value = d.name;
  document.getElementById('editDebtorDesc').value = d.description || '';
  document.getElementById('editDebtorDueDate').value = d.dueDate || '';
  document.getElementById('editDebtorRate').value = d.rate || '';
  editSelectedItems.push(...(d.products || []).map(p => ({ ...p })));
  updateEditUI();
  document.getElementById('editDebtorModal').style.display = 'flex';
}

function closeEditDebtorModal() {
  document.getElementById('editDebtorModal').style.display = 'none';
  editingDebtorId = null;
}
document.getElementById('editDebtorModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeEditDebtorModal(); });

const editSearchInput = document.getElementById('editProductSearch');
if (editSearchInput) {
  editSearchInput.addEventListener('input', () => renderEditDropdown(editSearchInput.value));
  editSearchInput.addEventListener('focus', () => renderEditDropdown(editSearchInput.value));
  document.getElementById('editProductDropdown').addEventListener('click', (e) => {
    const el = e.target.closest('.dropdown-item');
    if (!el) return;
    if (editSelectedItems.some(s => s.id === el.dataset.id)) return;
    editSelectedItems.push({ id: el.dataset.id, name: el.dataset.name, price: parseFloat(el.dataset.price) || 0, quantity: 1 });
    editSearchInput.value = '';
    document.getElementById('editProductDropdown').style.display = 'none';
    updateEditUI();
    renderEditDropdown('');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#editProductSelect') && !e.target.closest('#editSelectedProducts')) {
      document.getElementById('editProductDropdown').style.display = 'none';
    }
  });
}

document.getElementById('editDebtorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editingDebtorId) return;
  const name = document.getElementById('editDebtorName').value.trim();
  const description = document.getElementById('editDebtorDesc').value.trim();
  const dueDate = document.getElementById('editDebtorDueDate').value;
  const rate = document.getElementById('editDebtorRate').value;
  const products = editSelectedItems.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity }));
  if (!name) return;
  const totalFromProducts = products.reduce((sum, p) => sum + (p.price * p.quantity), 0);
  await fetch(`/api/debtors/${editingDebtorId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: description || '', dueDate: dueDate || null, rate: parseFloat(rate) || 1, products, amount: totalFromProducts })
  });
  closeEditDebtorModal();
  editSelectedItems.length = 0;
  loadDebtors();
  loadInventory();
  refreshProductSearch();
  showToast('Deudor actualizado correctamente');
});

async function deleteDebtor(id) {
  if (!confirm('¿Eliminar este deudor?')) return;
  await fetch(`/api/debtors/${id}`, { method: 'DELETE' });
  loadDebtors();
  showToast('Deudor eliminado');
}

async function loadInventory() {
  const invRes = await fetch('/api/inventory?_=' + Date.now());
  const items = await invRes.json();
  items.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const container = document.getElementById('inventoryList');
  if (!container) return;
  if (items.length === 0) {
    container.innerHTML = '<div class="empty">No hay productos en el inventario</div>';
    return;
  }
  container.innerHTML = items.map(item => `
    <div class="item-card">
      <div class="item-info">
        <span class="item-name">${esc(item.name)}</span>
        <span class="item-qty">Cant: ${item.quantity}</span>
      </div>
      ${item.price ? `<div class="item-price">$${item.price.toFixed(2)} c/u</div>` : ''}
      <div class="item-actions">
        <button class="btn-edit" onclick="editItem('${item.id}')">Editar</button>
        <button class="btn-delete" onclick="deleteItem('${item.id}')">Eliminar</button>
      </div>
    </div>
  `).join('');
}

let editingItemId = null;

async function editItem(id) {
  const res = await fetch('/api/inventory');
  const items = await res.json();
  const item = items.find(i => i.id === id);
  if (!item) return;
  editingItemId = id;
  document.getElementById('editItemName').value = item.name;
  document.getElementById('editItemQty').value = item.quantity;
  document.getElementById('editItemPrice').value = item.price || '';
  document.getElementById('editItemModal').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('editItemModal').style.display = 'none';
  editingItemId = null;
}
document.getElementById('editItemModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeEditModal(); });

document.getElementById('editItemForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editingItemId) return;
  const name = document.getElementById('editItemName').value.trim();
  const quantity = document.getElementById('editItemQty').value;
  const price = document.getElementById('editItemPrice').value || 0;
  if (!name || !quantity) return;
  await fetch(`/api/inventory/${editingItemId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, quantity: parseInt(quantity), price: parseFloat(price) || 0 })
  });
  closeEditModal();
  loadInventory();
  refreshProductSearch();
  showToast('Producto actualizado');
});

async function deleteItem(id) {
  if (!confirm('¿Eliminar este producto?')) return;
  await fetch(`/api/inventory/${id}`, { method: 'DELETE' });
  loadInventory();
  refreshProductSearch();
  showToast('Producto eliminado del inventario');
}

let productSearchItems = [];

async function initProductSearch() {
  const res = await fetch('/api/inventory');
  productSearchItems = await res.json();
  const items = productSearchItems;
  const searchInput = document.getElementById('productSearch');
  const dropdown = document.getElementById('productDropdown');
  const container = document.getElementById('selectedProducts');
  const multiTotal = document.getElementById('multiTotal');
  const amountInput = document.getElementById('debtorAmount');

  function updateUI() {
    if (selectedItems.length === 0) {
      container.innerHTML = '';
      multiTotal.textContent = '$0.00';
      amountInput.value = '';
      return;
    }
    let total = 0;
    container.innerHTML = selectedItems.map((item, idx) => {
      const subtotal = item.price * item.quantity;
      total += subtotal;
      return `<div class="selected-item">
        <div class="selected-item-info">
          <span class="selected-item-name">${esc(item.name)}</span>
          <span class="selected-item-price">$${item.price.toFixed(2)} c/u</span>
        </div>
        <div class="selected-item-controls">
          <input type="number" class="selected-item-qty" data-idx="${idx}" value="${item.quantity}" min="1">
          <span class="selected-item-subtotal">$${subtotal.toFixed(2)}</span>
          <button class="btn-remove" data-idx="${idx}">×</button>
        </div>
      </div>`;
    }).join('');
    multiTotal.textContent = '$' + total.toFixed(2);
    if (!amountManuallySet) amountInput.value = total.toFixed(2);
    container.querySelectorAll('.selected-item-qty').forEach(inp => {
      inp.addEventListener('input', () => {
        selectedItems[parseInt(inp.dataset.idx)].quantity = parseInt(inp.value) || 1;
        updateUI();
      });
    });
    container.querySelectorAll('.btn-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedItems.splice(parseInt(btn.dataset.idx), 1);
        updateUI();
      });
    });
  }

  function renderDropdown(filter) {
    const filtered = (filter
      ? items.filter(i => i.name.toLowerCase().includes(filter.toLowerCase()))
      : items).filter(i => i.quantity > 0 && !selectedItems.some(s => s.id === i.id));
    if (filtered.length === 0) { dropdown.style.display = 'none'; return; }
    dropdown.innerHTML = filtered.map(i =>
      `<div class="dropdown-item" data-id="${i.id}" data-name="${esc(i.name)}" data-price="${i.price}">${esc(i.name)} <small>(${i.quantity} disp. ${i.price ? '- $' + i.price.toFixed(2) : ''})</small></div>`
    ).join('');
    dropdown.style.display = 'block';
  }

  searchInput.addEventListener('input', () => renderDropdown(searchInput.value));
  dropdown.addEventListener('click', (e) => {
    const el = e.target.closest('.dropdown-item');
    if (!el) return;
    if (selectedItems.some(s => s.id === el.dataset.id)) return;
    selectedItems.push({ id: el.dataset.id, name: el.dataset.name, price: parseFloat(el.dataset.price) || 0, quantity: 1 });
    searchInput.value = '';
    dropdown.style.display = 'none';
    updateUI();
    renderDropdown('');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-select') && !e.target.closest('.selected-products')) dropdown.style.display = 'none';
  });
  searchInput.addEventListener('focus', () => renderDropdown(searchInput.value));
  amountInput.addEventListener('input', () => { amountManuallySet = true; });
  document.getElementById('debtorForm').addEventListener('reset', () => { amountManuallySet = false; });
}

async function refreshProductSearch() {
  const res = await fetch('/api/inventory');
  productSearchItems = await res.json();
  const searchInput = document.getElementById('productSearch');
  if (searchInput) {
    const dropdown = document.getElementById('productDropdown');
    const filtered = productSearchItems.filter(i => i.quantity > 0 && !selectedItems.some(s => s.id === i.id));
    if (filtered.length === 0) { dropdown.style.display = 'none'; return; }
    dropdown.innerHTML = filtered.map(i =>
      `<div class="dropdown-item" data-id="${i.id}" data-name="${esc(i.name)}" data-price="${i.price}">${esc(i.name)} <small>(${i.quantity} disp. ${i.price ? '- $' + i.price.toFixed(2) : ''})</small></div>`
    ).join('');
  }
}

let historyDebtorId = null;

async function showPayHistory(id) {
  historyDebtorId = id;
  await renderPayHistory();
  document.getElementById('historyModal').style.display = 'flex';
}

async function renderPayHistory() {
  const res = await fetch('/api/debtors');
  const debtors = await res.json();
  const d = debtors.find(x => x.id === historyDebtorId);
  if (!d) return;
  const container = document.getElementById('historyList');
  const header = document.querySelector('#historyModal .modal-content h3');
  if (header) header.textContent = `Abonos - ${esc(d.name)}`;
  if (!d.payments || d.payments.length === 0) {
    container.innerHTML = '<div class="empty">No hay abonos registrados</div>';
    return;
  }
  let totalPaid = 0;
  container.innerHTML = d.payments.map((p, idx) => {
    totalPaid += p.amount;
    return `<div class="history-item">
      <div class="history-item-header">
        <span class="history-num">#${idx + 1}</span>
        <span class="history-amount">$${p.amount.toFixed(2)}</span>
      </div>
      <div class="history-meta">
        <span class="history-date">${new Date(p.date).toLocaleString()}</span>
        <span class="history-by">${esc(p.registeredBy || 'unknown')}</span>
      </div>
      ${p.note ? `<div class="history-note">${esc(p.note)}</div>` : ''}
      <div class="history-actions">
        <button class="btn-edit-sm" onclick="editPayment(${idx})">Editar</button>
        <button class="btn-delete-sm" onclick="deletePayment(${idx})">Eliminar</button>
      </div>
    </div>`;
  }).join('');
  container.innerHTML += `<div class="history-total">Total abonado: <strong>$${totalPaid.toFixed(2)}</strong></div>`;
}

async function deletePayment(idx) {
  if (!confirm('¿Eliminar este abono? Se devolverá el monto al deudor.')) return;
  await fetch(`/api/debtors/${historyDebtorId}/payments/${idx}`, { method: 'DELETE' });
  await renderPayHistory();
  loadDebtors();
  showToast('Abono eliminado');
}

async function editPayment(idx) {
  const res = await fetch('/api/debtors');
  const debtors = await res.json();
  const d = debtors.find(x => x.id === historyDebtorId);
  if (!d || !d.payments[idx]) return;
  const newAmount = prompt('Nuevo monto:', d.payments[idx].amount.toFixed(2));
  if (!newAmount || parseFloat(newAmount) <= 0) return;
  const newNote = prompt('Nueva nota:', d.payments[idx].note || '');
  if (newNote === null) return;
  await fetch(`/api/debtors/${historyDebtorId}/payments/${idx}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: parseFloat(newAmount), note: newNote })
  });
  await renderPayHistory();
  loadDebtors();
  showToast('Abono actualizado');
}

function closePayHistory() {
  document.getElementById('historyModal').style.display = 'none';
}
document.getElementById('historyModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) closePayHistory(); });

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(20px)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function fmt(n) {
  return n.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
