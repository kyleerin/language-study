// API client for Korean Study backend
const API_BASE_URL = 'http://localhost:3001';

// Get API key from environment or prompt user
function getAPIKey() {
  // Try to get from localStorage first (for development)
  let apiKey = localStorage.getItem('korean-study-api-key');
  
  if (!apiKey) {
    apiKey = prompt('Enter your API key for Korean Study backend:');
    if (apiKey) {
      localStorage.setItem('korean-study-api-key', apiKey);
    }
  }
  
  return apiKey;
}

class APIError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'APIError';
    this.status = status;
  }
}

async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const apiKey = getAPIKey();
  
  if (!apiKey && !endpoint.includes('/health')) {
    throw new APIError('API key required', 401);
  }
  
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey && { 'X-API-Key': apiKey }),
      ...options.headers,
    },
    ...options,
  };

  try {
    const response = await fetch(url, config);
    
    if (response.status === 401) {
      // Clear invalid API key and prompt for new one
      localStorage.removeItem('korean-study-api-key');
      throw new APIError('Invalid API key - please refresh and try again', 401);
    }
    
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

// OpenAI API (via backend proxy)
export const openaiAPI = {
  // Translate text
  translate: (text, prompt) => apiRequest('/api/openai/translate', {
    method: 'POST',
    body: JSON.stringify({ text, prompt }),
  }),

  // Explain Korean text
  explain: (text) => apiRequest('/api/openai/explain', {
    method: 'POST',
    body: JSON.stringify({ text }),
  }),
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

// Clear stored API key (for logout/reset)
export function clearAPIKey() {
  localStorage.removeItem('korean-study-api-key');
}

export { APIError };