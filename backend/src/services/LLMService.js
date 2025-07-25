const OpenAI = require('openai');
const { query } = require('../config/database');

class LLMService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  // Generate automated reply based on email content
  async generateReply(emailContent, senderEmail, recipientEmail, context = {}) {
    try {
      const { tone = 'professional', language = 'en', customInstructions = '' } = context;
      
      // Get user's reply preferences
      const preferences = await this.getUserReplyPreferences(recipientEmail);
      
      // Build context for the AI
      const systemPrompt = this.buildSystemPrompt(tone, language, preferences, customInstructions);
      
      // Extract important information from the original email
      const emailAnalysis = await this.analyzeEmail(emailContent);
      
      // Generate reply
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: `Original email content: "${emailContent}"\n\nEmail analysis: ${JSON.stringify(emailAnalysis)}\n\nGenerate an appropriate reply.`
          }
        ],
        max_tokens: 1000,
        temperature: 0.7
      });

      const generatedReply = response.choices[0].message.content;
      
      // Log the generated reply for learning
      await this.logGeneratedReply(senderEmail, recipientEmail, emailContent, generatedReply, context);
      
      return {
        reply: generatedReply,
        analysis: emailAnalysis,
        confidence: this.calculateConfidence(emailAnalysis),
        suggestions: this.generateSuggestions(emailAnalysis)
      };
    } catch (error) {
      throw new Error(`Failed to generate reply: ${error.message}`);
    }
  }

  // Analyze email content to understand intent and context
  async analyzeEmail(emailContent) {
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `You are an email analysis assistant. Analyze the email and return a JSON object with the following structure:
            {
              "intent": "question|request|complaint|compliment|information|meeting|other",
              "urgency": "low|medium|high",
              "sentiment": "positive|neutral|negative",
              "topics": ["topic1", "topic2"],
              "requiresAction": boolean,
              "suggestedResponseType": "acknowledgment|detailed_response|scheduling|referral|other",
              "keyPoints": ["point1", "point2"],
              "questions": ["question1", "question2"]
            }`
          },
          {
            role: 'user',
            content: emailContent
          }
        ],
        max_tokens: 500,
        temperature: 0.3
      });

      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      // Return default analysis if parsing fails
      return {
        intent: 'other',
        urgency: 'medium',
        sentiment: 'neutral',
        topics: [],
        requiresAction: false,
        suggestedResponseType: 'acknowledgment',
        keyPoints: [],
        questions: []
      };
    }
  }

  // Build system prompt based on user preferences
  buildSystemPrompt(tone, language, preferences, customInstructions) {
    let prompt = `You are an intelligent email assistant helping to generate professional email replies. 

TONE: ${tone}
LANGUAGE: ${language}

GUIDELINES:
- Keep responses concise but complete
- Be ${tone} in tone
- Address all key points from the original email
- If questions were asked, provide clear answers
- Include appropriate greetings and closings
- Maintain the conversation context`;

    if (preferences.signature) {
      prompt += `\n- End emails with this signature: ${preferences.signature}`;
    }

    if (preferences.autoResponses) {
      prompt += `\n- Use these common responses when appropriate: ${JSON.stringify(preferences.autoResponses)}`;
    }

    if (customInstructions) {
      prompt += `\n\nADDITIONAL INSTRUCTIONS: ${customInstructions}`;
    }

    prompt += `\n\nIMPORTANT: Generate only the email reply content. Do not include "Subject:" or email headers.`;

    return prompt;
  }

  // Get user's reply preferences
  async getUserReplyPreferences(userEmail) {
    try {
      const result = await query(`
        SELECT preferences FROM user_reply_preferences 
        WHERE email = $1
      `, [userEmail]);

      return result.rows[0]?.preferences || {
        signature: '',
        autoResponses: {},
        defaultTone: 'professional',
        language: 'en'
      };
    } catch (error) {
      return {
        signature: '',
        autoResponses: {},
        defaultTone: 'professional',
        language: 'en'
      };
    }
  }

  // Save user's reply preferences
  async saveReplyPreferences(userEmail, preferences) {
    try {
      await query(`
        INSERT INTO user_reply_preferences (email, preferences, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (email)
        DO UPDATE SET preferences = $2, updated_at = NOW()
      `, [userEmail, JSON.stringify(preferences)]);

      return true;
    } catch (error) {
      throw new Error(`Failed to save preferences: ${error.message}`);
    }
  }

  // Calculate confidence score for the generated reply
  calculateConfidence(analysis) {
    let confidence = 0.7; // Base confidence

    // Increase confidence for clear intents
    if (['question', 'request', 'meeting'].includes(analysis.intent)) {
      confidence += 0.1;
    }

    // Increase confidence if key points are identified
    if (analysis.keyPoints && analysis.keyPoints.length > 0) {
      confidence += 0.1;
    }

    // Decrease confidence for negative sentiment
    if (analysis.sentiment === 'negative') {
      confidence -= 0.2;
    }

    // Decrease confidence for high urgency (might need human review)
    if (analysis.urgency === 'high') {
      confidence -= 0.1;
    }

    return Math.max(0.1, Math.min(1.0, confidence));
  }

  // Generate suggestions for improving the reply
  generateSuggestions(analysis) {
    const suggestions = [];

    if (analysis.urgency === 'high') {
      suggestions.push('This email appears urgent. Consider reviewing and sending quickly.');
    }

    if (analysis.sentiment === 'negative') {
      suggestions.push('The original email has negative sentiment. Consider a more empathetic response.');
    }

    if (analysis.questions && analysis.questions.length > 0) {
      suggestions.push(`Make sure to address these questions: ${analysis.questions.join(', ')}`);
    }

    if (analysis.requiresAction) {
      suggestions.push('This email requires action. Consider adding specific next steps or deadlines.');
    }

    return suggestions;
  }

  // Log generated reply for learning and improvement
  async logGeneratedReply(senderEmail, recipientEmail, originalContent, generatedReply, context) {
    try {
      await query(`
        INSERT INTO llm_reply_log (
          sender_email, recipient_email, original_content, 
          generated_reply, context, created_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW())
      `, [senderEmail, recipientEmail, originalContent, generatedReply, JSON.stringify(context)]);
    } catch (error) {
      console.error('Failed to log generated reply:', error);
    }
  }

  // Generate follow-up email based on previous conversation
  async generateFollowUp(conversationHistory, followUpType, context = {}) {
    try {
      const { delay = '3 days', purpose = 'check-in' } = context;
      
      const systemPrompt = `You are generating a follow-up email. 
      
FOLLOW-UP TYPE: ${followUpType}
PURPOSE: ${purpose}
DELAY: ${delay}

Create a professional follow-up email that:
- References the previous conversation appropriately
- Has a clear purpose
- Includes a call to action if needed
- Maintains a professional but friendly tone`;

      const conversationContext = conversationHistory.map(email => 
        `From: ${email.from}\nTo: ${email.to}\nSubject: ${email.subject}\nContent: ${email.content}`
      ).join('\n\n---\n\n');

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: `Previous conversation:\n${conversationContext}\n\nGenerate an appropriate follow-up email.`
          }
        ],
        max_tokens: 800,
        temperature: 0.7
      });

      return {
        subject: this.extractSubjectFromReply(response.choices[0].message.content),
        content: response.choices[0].message.content,
        followUpType,
        suggestedDelay: delay
      };
    } catch (error) {
      throw new Error(`Failed to generate follow-up: ${error.message}`);
    }
  }

  // Extract subject line from generated content
  extractSubjectFromReply(content) {
    const lines = content.split('\n');
    const subjectLine = lines.find(line => line.toLowerCase().startsWith('subject:'));
    
    if (subjectLine) {
      return subjectLine.substring(8).trim();
    }

    // Generate subject based on content
    const firstSentence = content.split('.')[0];
    return `Re: ${firstSentence.substring(0, 50)}...`;
  }

  // Categorize email content
  async categorizeEmail(emailContent, subject, sender) {
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `Categorize this email into one of these categories: 
            - important (urgent business matters, deadlines, critical issues)
            - personal (personal communications, non-work related)
            - promotional (marketing, advertisements, newsletters)
            - social (social media notifications, updates)
            - spam (suspicious, unwanted content)
            - automated (system notifications, receipts, confirmations)
            - work (regular business communications)
            
            Return only the category name.`
          },
          {
            role: 'user',
            content: `Subject: ${subject}\nFrom: ${sender}\nContent: ${emailContent}`
          }
        ],
        max_tokens: 10,
        temperature: 0.1
      });

      const category = response.choices[0].message.content.trim().toLowerCase();
      
      // Validate category
      const validCategories = ['important', 'personal', 'promotional', 'social', 'spam', 'automated', 'work'];
      return validCategories.includes(category) ? category : 'work';
    } catch (error) {
      console.error('Failed to categorize email:', error);
      return 'work'; // Default category
    }
  }

  // Generate email summary
  async summarizeEmail(emailContent, maxLength = 150) {
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: `Summarize the email content in ${maxLength} characters or less. Focus on the main points and action items.`
          },
          {
            role: 'user',
            content: emailContent
          }
        ],
        max_tokens: Math.ceil(maxLength / 3),
        temperature: 0.3
      });

      return response.choices[0].message.content.trim();
    } catch (error) {
      // Fallback to simple truncation
      return emailContent.substring(0, maxLength) + '...';
    }
  }

  // Get reply statistics for a user
  async getReplyStats(userEmail) {
    try {
      const result = await query(`
        SELECT 
          COUNT(*) as total_generated,
          COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as this_week,
          COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as this_month,
          AVG(CASE WHEN feedback_rating IS NOT NULL THEN feedback_rating END) as avg_rating
        FROM llm_reply_log 
        WHERE recipient_email = $1
      `, [userEmail]);

      return result.rows[0] || {
        total_generated: 0,
        this_week: 0,
        this_month: 0,
        avg_rating: null
      };
    } catch (error) {
      return {
        total_generated: 0,
        this_week: 0,
        this_month: 0,
        avg_rating: null
      };
    }
  }

  // Provide feedback on generated reply
  async provideFeedback(logId, rating, feedback = '') {
    try {
      await query(`
        UPDATE llm_reply_log 
        SET feedback_rating = $2, feedback_text = $3, feedback_at = NOW()
        WHERE id = $1
      `, [logId, rating, feedback]);

      return true;
    } catch (error) {
      throw new Error(`Failed to save feedback: ${error.message}`);
    }
  }
}

module.exports = LLMService;
