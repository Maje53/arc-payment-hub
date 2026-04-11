import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import dotenv from 'dotenv'
dotenv.config()

const app = express()
app.use(express.json())

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

app.post('/api/ask', async (req, res) => {
  const { question } = req.body
  if (!question) return res.status(400).json({ error: 'Question required' })
  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: question }],
    })
    res.json({ answer: message.content[0].text })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.listen(3001, () => console.log('Backend running on http://localhost:3001'))