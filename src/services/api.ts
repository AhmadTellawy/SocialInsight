const API_BASE_URL = 'http://localhost:3001/api';

export const api = {
    getSurveys: async () => {
        const response = await fetch(`${API_BASE_URL}/surveys`);
        if (!response.ok) throw new Error('Failed to fetch surveys');
        return response.json();
    },

    getSurveyById: async (id: string) => {
        const response = await fetch(`${API_BASE_URL}/surveys/${id}`);
        if (!response.ok) throw new Error('Failed to fetch survey');
        return response.json();
    },

    vote: async (surveyId: string, optionId: string) => {
        const response = await fetch(`${API_BASE_URL}/surveys/${surveyId}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ optionId })
        });
        if (!response.ok) throw new Error('Failed to vote');
        return response.json();
    },

    getUsers: async () => {
        const response = await fetch(`${API_BASE_URL}/users`);
        if (!response.ok) throw new Error('Failed to fetch users');
        return response.json();
    },

    getGroups: async () => {
        const response = await fetch(`${API_BASE_URL}/groups`);
        if (!response.ok) throw new Error('Failed to fetch groups');
        return response.json();
    }
};
