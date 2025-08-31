// API client for Korean Study backend
const API_BASE_URL = 'http://localhost:3001';

class APIError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'APIError';
    this.status = status;
  }
}

async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  try {
    const response = await fetch(url, config);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new APIError(errorData.error || `HTTP ${response.status}`, response.status);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    // Network or other fetch errors
    throw new APIError(`Network error: ${error.message}`, 0);
  }
}

// Phrases API
export const phrasesAPI = {
  // Get all phrases
  getAll: () => apiRequest('/api/phrases'),

  // Add new phrase
  add: (phrase) => apiRequest('/api/phrases', {
    method: 'POST',
    body: JSON.stringify(phrase),
  }),

  // Update phrase by index
  update: (index, phrase) => apiRequest(`/api/phrases/${index}`, {
    method: 'PUT',
    body: JSON.stringify(phrase),
  }),

  // Delete phrase by index
  delete: (index) => apiRequest(`/api/phrases/${index}`, {
    method: 'DELETE',
  }),

  // Import CSV file
  import: async (file) => {
    const formData = new FormData();
    formData.append('csvFile', file);
    
    return apiRequest('/api/import', {
      method: 'POST',
      headers: {}, // Remove Content-Type to let browser set boundary for FormData
      body: formData,
    });
  },
};

// Study progress API
export const studiedAPI = {
  // Get all studied data
  getAll: () => apiRequest('/api/studied'),

  // Update all studied data
  updateAll: (studiedData) => apiRequest('/api/studied', {
    method: 'PUT',
    body: JSON.stringify(studiedData),
  }),

  // Mark/unmark single item
  updateItem: (id, isStudied) => apiRequest(`/api/studied/${id}`, {
    method: 'POST',
    body: JSON.stringify({ studied: isStudied }),
  }),

  // Clear all studied data
  clearAll: () => apiRequest('/api/studied', {
    method: 'DELETE',
  }),
};

// Health check
export const healthAPI = {
  check: () => apiRequest('/api/health'),
};

// Utility to check if backend is available
export async function isBackendAvailable() {
  try {
    await healthAPI.check();
    return true;
  } catch {
    return false;
  }
}

export { APIError };