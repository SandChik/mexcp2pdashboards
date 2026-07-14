import axios from 'axios';

const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use(res => res, err => {
  if (err.response?.status === 401) { localStorage.removeItem('token'); window.location.href = '/login'; }
  return Promise.reject(err);
});

export const authApi = {
  status: () => api.get('/auth/status'),
  login: (password) => api.post('/auth/login', { password }),
  setup: (password) => api.post('/auth/setup', { password }),
  changePassword: (old, nw) => api.post('/auth/change-password', { oldPassword: old, newPassword: nw })
};

export const merchantApi = {
  list: () => api.get('/merchants'),
  add: (data) => api.post('/merchants', data),
  update: (id, data) => api.put(`/merchants/${id}`, data),
  delete: (id) => api.delete(`/merchants/${id}`),
  serviceSwitch: (id, open) => api.post(`/merchants/${id}/service-switch`, { open }),
  balance: (id) => api.get(`/merchants/${id}/balance`),
  getPauseState: (id) => api.get(`/merchants/${id}/pause-state`),
  setPauseState: (id, paused, ads) => api.post(`/merchants/${id}/pause-state`, { paused, ads }),
  getSettings: (id) => api.get(`/merchants/${id}/settings`),
  setSettings: (id, settings) => api.post(`/merchants/${id}/settings`, settings)
};

export const adsApi = {
  list: (mid, params) => api.get(`/ads/${mid}`, { params }),
  market: (mid, params) => api.get(`/ads/${mid}/market`, { params }),
  saveOrUpdate: (mid, data) => api.post(`/ads/${mid}`, data),
  toggleStatus: (mid, adData, newStatus) => api.post(`/ads/${mid}/toggle-status`, { ...adData, advStatus: newStatus })
};

export const ordersApi = {
  list: (mid, params) => api.get(`/orders/${mid}`, { params }),
  market: (mid, params) => api.get(`/orders/${mid}/market`, { params }),
  marketQuick: (mid, params) => api.get(`/orders/${mid}/market`, { params: { ...params, quick: 'true' } }),
  detail: (mid, advOrderNo) => api.get(`/orders/${mid}/detail/${advOrderNo}`),
  memberIds: (mid, advOrderNos) => api.post(`/orders/${mid}/member-ids`, { advOrderNos }),
  captureStats: (mid, advOrderNos) => api.post(`/orders/${mid}/capture-stats`, { advOrderNos }),
  ftdStats: (mid) => api.get(`/orders/${mid}/ftd-stats`),
  confirmPaid: (mid, advOrderNo, userConfirmPaymentId) =>
    api.post(`/orders/${mid}/confirm-paid`, { advOrderNo, userConfirmPaymentId }),
  releaseCoin: (mid, advOrderNo) => api.post(`/orders/${mid}/release-coin`, { advOrderNo }),
  create: (mid, data) => api.post(`/orders/${mid}/create`, data)
};

export const registryApi = {
  list: (mid, all = false) => api.get(`/registry/${mid}`, { params: all ? { all: 'true' } : {} }),
  capture: (mid, orders) => api.post(`/registry/${mid}/capture`, { orders }),
  remove: (mid, advOrderNo) => api.delete(`/registry/${mid}/${advOrderNo}`)
};

export const chatApi = {
  getConversation: (mid, orderNo) => api.get(`/chat/${mid}/conversation/${orderNo}`),
  getMessages: (mid, cid, params) => api.get(`/chat/${mid}/messages/${cid}`, { params }),
  connect: (mid, cid) => api.post(`/chat/${mid}/connect/${cid}`),
  send: (mid, cid, content) => api.post(`/chat/${mid}/send`, { conversationId: cid, content }),
  sendImage: (mid, cid, imageUrl, imageThumbUrl) =>
    api.post(`/chat/${mid}/send-image`, { conversationId: cid, imageUrl, imageThumbUrl }),
  upload: (mid, formData) => api.post(`/chat/${mid}/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  download: (mid, fileId) => api.get(`/chat/${mid}/download/${fileId}`),
  status: (mid, cid) => api.get(`/chat/${mid}/status/${cid}`),
  disconnect: (mid, cid) => api.delete(`/chat/${mid}/disconnect/${cid}`)
};

export default api;
