import axios from "axios";

export class ChatService {
    static async sendMessage(message: string, userId: string, fullName: string, token?: string, sessionId?: string) {
        const n8nUrl = process.env.N8N_URL;
        
        if (!n8nUrl) {
            throw new Error("N8N_URL is not configured in the environment.");
        }

        try {
            const response = await axios.post(n8nUrl, {
                chatInput: message,
                userId: userId,
                userFullName: fullName,
                accessToken: token, // Pass token to n8n
                sessionId: sessionId, // Pass session ID to n8n
                timestamp: new Date().toISOString()
            });

            return response.data;
        } catch (error: any) {
            console.error("Error calling n8n:", error.message);
            throw new Error("Không thể kết nối với Chatbot. Vui lòng thử lại sau.");
        }
    }
}
