// AI Voice Assistant — Full Real-Time AI Conversation via WebSocket Streaming (with WebSocket connection debug)

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const { Buffer } = require("buffer");
const atob = (base64) => Buffer.from(base64, "base64");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const twilio = require("twilio");
const twilioClient = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH);

let memory = [];

// === Trigger Outbound Call ===
app.post("/start-call", async (req, res) => {
  const { targetNumber } = req.body;
  try {
    await twilioClient.calls.create({
      to: targetNumber,
      from: process.env.TWILIO_NUMBER,
      url: `${req.protocol}://${req.get("host")}/voice-stream`
    });
    res.send("✅ Real-time AI call started.");
  } catch (err) {
    console.error("❌ Call error:", err);
    res.status(500).send("Call failed: " + err.message);
  }
});

// === Twilio <Stream> Voice Response ===
app.post("/voice-stream", (req, res) => {
  console.log("📞 Incoming call connected via voice-stream route");
  const response = new twilio.twiml.VoiceResponse();
  response.say("Hi, this is Mihireatab's assistant calling to schedule a dental appointment.");
  response.connect().stream({ url: `wss://${req.get("host")}/ws` });
  res.type("text/xml").send(response.toString());
});

// === WebSocket Audio Stream Handler ===
wss.on("connection", (ws) => {
  console.log("🔗 WebSocket connected");
  ws.send(JSON.stringify({ event: "media", media: { payload: "" } }));
  console.log("📡 Sent test payload immediately after connection");

  ws.on("message", async (msg) => {
    try {
      const parsed = JSON.parse(msg);

      if (parsed.event === "start") {
        console.log("🎙️ Call started");
        memory = [
          {
            role: "system",
            content: "You are Mihireatab Bete’s assistant calling the dental clinic to schedule a checkup. Be professional, confident, and short."
          },
          { role: "user", content: "Hi, I'm Mihireatab's assistant. He'd like to book an appointment." }
        ];
      } else if (parsed.event === "media") {
        try {
          console.log("🎧 MEDIA event triggered");
          if (!parsed.media || !parsed.media.payload) {
            console.log("⚠️ No media payload received");
            return;
          }

          const audioData = atob(parsed.media.payload);
          const wav = `temp/${uuidv4()}.wav`;
          fs.writeFileSync(wav, audioData);
          console.log("✅ Saved audio to", wav);

          const formData = new (require("form-data"))();
          formData.append("file", fs.createReadStream(wav));
          formData.append("model", "whisper-1");

          console.log("📤 Sending to Whisper...");
          const whisper = await axios.post("https://api.openai.com/v1/audio/transcriptions", formData, {
            headers: {
              ...formData.getHeaders(),
              Authorization: `Bearer ${process.env.OPENAI_KEY}`
            }
          });

          const userText = whisper.data.text;
          console.log("🧠 Whisper transcript:", userText);
          if (!userText || userText.length < 1) return;
          memory.push({ role: "user", content: userText });

          console.log("📤 Sending to GPT...");
          const gpt = await axios.post(
            "https://api.openai.com/v1/chat/completions",
            {
              model: "gpt-4o",
              messages: memory,
              temperature: 0.4,
              max_tokens: 200
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.OPENAI_KEY}`,
                "Content-Type": "application/json"
              }
            }
          );

          const reply = gpt.data.choices[0].message.content;
          console.log("🤖 GPT reply:", reply);
          memory.push({ role: "assistant", content: reply });

          console.log("🎤 Sending to TTS...");
          const speech = await axios.post(
            "https://api.openai.com/v1/audio/speech",
            {
              model: "tts-1-hd",
              voice: "nova",
              input: reply
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.OPENAI_KEY}`,
                "Content-Type": "application/json"
              },
              responseType: "arraybuffer"
            }
          );

          const base64Audio = Buffer.from(speech.data).toString("base64");
          console.log("📡 Sending audio back over WebSocket");
          ws.send(
            JSON.stringify({
              event: "media",
              media: { payload: base64Audio }
            })
          );

          fs.unlinkSync(wav);
        } catch (err) {
          console.error("❌ Error inside MEDIA block:", err?.response?.data || err.message || err);
        }
      } else if (parsed.event === "stop") {
        console.log("📞 Call ended");
        ws.close();
      }
    } catch (err) {
      console.error("❌ WebSocket error:", err?.response?.data || err.message || err);
    }
  });
});

// === Serve the HTML Form ===
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

server.listen(PORT, () => console.log(`🌐 Voice AI server running on port ${PORT}`));
