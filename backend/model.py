import torch
import torch.nn as nn
import math

class TemporalFusionTransformer(nn.Module):
    """
    Simplified implementation of a Temporal Fusion Transformer (TFT) for time-series forecasting.
    Optimized for financial data with attention mechanisms.
    """
    def __init__(self, input_dim, hidden_dim, output_dim, num_heads=4):
        super(TemporalFusionTransformer, self).__init__()
        self.hidden_dim = hidden_dim
        
        # 1. Input Processing
        self.embedding = nn.Linear(input_dim, hidden_dim)
        self.pos_encoder = PositionalEncoding(hidden_dim)
        
        # 2. Variable Selection Networks (Simplified as LSTM for now)
        self.lstm = nn.LSTM(hidden_dim, hidden_dim, batch_first=True, bidirectional=True)
        
        # 3. Temporal Self-Attention
        self.attention = nn.MultiheadAttention(embed_dim=hidden_dim * 2, num_heads=num_heads, batch_first=True)
        
        # 4. Output Layer
        self.output_layer = nn.Linear(hidden_dim * 2, output_dim)
        
        # Gate components
        self.gate = nn.Sigmoid()

    def forward(self, x):
        # x shape: [batch_size, seq_len, input_dim]
        
        # Embed and add positional encoding
        x = self.embedding(x)
        x = self.pos_encoder(x)
        
        # LSTM for local processing
        lstm_out, _ = self.lstm(x)
        
        # Attention for long-range dependencies
        attn_out, _ = self.attention(lstm_out, lstm_out, lstm_out)
        
        # Residual connection + Gating
        combined = (lstm_out + attn_out) * self.gate(torch.mean(x, dim=-1, keepdim=True))
        
        # Final prediction
        prediction = self.output_layer(combined[:, -1, :]) # Take last step
        return prediction

class PositionalEncoding(nn.Module):
    def __init__(self, d_model, max_len=5000):
        super(PositionalEncoding, self).__init__()
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        pe = pe.unsqueeze(0)
        self.register_buffer('pe', pe)

    def forward(self, x):
        return x + self.pe[:, :x.size(1)]
