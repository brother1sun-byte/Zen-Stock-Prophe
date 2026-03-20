import pandas as pd
import numpy as np
import yfinance
from datetime import datetime, timedelta

class DataIngestion:
    def __init__(self):
        self.market_suffix = ".T" # Tokyo Stock Exchange

    def fetch_stock_data(self, ticker: str, period: str = "2y", interval: str = "1d", asof: str = None):
        """
        Fetches historical data for a given ticker.
        Handles JST asof for reproducible results.
        """
        # Logic for Japanese stocks (numeric 4-digit) vs others
        if ticker.isdigit() and len(ticker) == 4:
            full_ticker = f"{ticker}{self.market_suffix}"
        else:
            full_ticker = ticker
        
        # Calculate JST end date
        if asof:
            end_date = datetime.strptime(asof, "%Y-%m-%d") + timedelta(days=1)
        else:
            # Default to today JST
            end_date = datetime.utcnow() + timedelta(hours=9)
            
        print(f"Fetching data for {full_ticker} ({interval}) end={end_date.strftime('%Y-%m-%d')}...")
        stock = yfinance.Ticker(full_ticker)
        
        # We fetch a bit more to handle the offset, then truncate
        df = stock.history(period=period, interval=interval, end=end_date.strftime('%Y-%m-%d'))
        
        if df.empty:
            raise ValueError(f"No data found for {full_ticker}")
            
        # Feature Engineering for AI
        df['Returns'] = df['Close'].pct_change()
        # MA calculation depends on interval (1d or 1wk)
        window_short = 25 if interval == "1d" else 13
        window_long = 75 if interval == "1d" else 26
        df['MA_Short'] = df['Close'].rolling(window=window_short).mean()
        df['MA_Long'] = df['Close'].rolling(window=window_long).mean()
        
        # Zen Article Indicators
        df['RSI'] = self.calculate_rsi(df['Close'], 14)
        df['VolMA20'] = df['Volume'].rolling(window=20).mean()
        
        # Bollinger Bands (20-period, 2σ)
        bb_mid = df['Close'].rolling(window=20).mean()
        bb_std = df['Close'].rolling(window=20).std()
        df['BB_Upper'] = bb_mid + 2 * bb_std
        df['BB_Lower'] = bb_mid - 2 * bb_std
        df['BB_Width'] = (df['BB_Upper'] - df['BB_Lower']) / bb_mid

        # MACD (12, 26, 9)
        exp12 = df['Close'].ewm(span=12, adjust=False).mean()
        exp26 = df['Close'].ewm(span=26, adjust=False).mean()
        df['MACD'] = exp12 - exp26
        df['MACD_Signal'] = df['MACD'].ewm(span=9, adjust=False).mean()
        df['MACD_Hist'] = df['MACD'] - df['MACD_Signal']
        
        # Drop only rows where Close is NaN
        df = df.dropna(subset=['Close'])
        return df

    def calculate_rsi(self, series, period=14):
        """Standard RSI calculation matching Zen article logic."""
        delta = series.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = ((-delta.where(delta < 0, 0)).rolling(window=period).mean())
        # Avoid division by zero
        rs = gain / loss.replace(0, np.nan)
        rsi = 100 - (100 / (1 + rs))
        return rsi.fillna(100 if (loss == 0).any() else 0)

    def fetch_fundamentals(self, ticker: str, asof: str = None):
        """Phase 2: Fetch detailed fundamentals for long-term snapshot."""
        if ticker.isdigit() and len(ticker) == 4:
            full_ticker = f"{ticker}{self.market_suffix}"
        else:
            full_ticker = ticker
        stock = yfinance.Ticker(full_ticker)
        info = stock.info
        
        return {
            "roe": info.get('returnOnEquity'),
            "operating_margin": info.get('operatingMargins'),
            "revenue_growth": info.get('revenueGrowth'),
            "equity_ratio": info.get('bookValue', 0) * info.get('sharesOutstanding', 0) / info.get('totalAssets', 1) if info.get('totalAssets') else None,
            "debt_to_equity": info.get('debtToEquity'),
            "dividend_yield": info.get('dividendYield'),
            "payout_ratio": info.get('payoutRatio'),
            "per": info.get('trailingPE'),
            "pbr": info.get('priceToBook'),
            "forward_per": info.get('forwardPE'),
            "sector": info.get('sector'),
            "industry": info.get('industry')
        }

    def fetch_calendar_events(self, ticker: str, asof: str = None):
        """Phase 2: Fetch upcoming dividends and earnings with JST asof criteria."""
        if ticker.isdigit() and len(ticker) == 4:
            full_ticker = f"{ticker}{self.market_suffix}"
        else:
            full_ticker = ticker
        stock = yfinance.Ticker(full_ticker)
        
        if asof:
            asof_date = datetime.strptime(asof, "%Y-%m-%d")
        else:
            asof_date = datetime.utcnow() + timedelta(hours=9)
            
        calendar = stock.calendar
        dividends = stock.dividends.tail(10) if not stock.dividends.empty else pd.Series()
        
        # Event Window logic (Reproducible 7 days)
        window_end = asof_date + timedelta(days=7)
        is_imminent = False
        imminent_events = []
        
        if calendar is not None and not calendar.empty:
            # yfinance calendar often has 'Earnings Date' or similar
            # For simplicity, we check if any date in calendar is within [asof_date, window_end]
            for col in calendar.columns:
                for val in calendar[col]:
                    if isinstance(val, (datetime, pd.Timestamp)):
                        # Remove timezone for comparison
                        ts = val.replace(tzinfo=None)
                        if asof_date <= ts <= window_end:
                            is_imminent = True
                            imminent_events.append({"event": "Earnings", "date": ts.strftime("%Y-%m-%d")})
                            
        # Check dividends
        if not dividends.empty:
            for dt, val in dividends.items():
                ts = dt.replace(tzinfo=None)
                if asof_date <= ts <= window_end:
                    is_imminent = True
                    imminent_events.append({"event": "Dividend", "date": ts.strftime("%Y-%m-%d"), "value": val})

        return {
            "calendar": calendar.to_dict() if calendar is not None and not calendar.empty else {},
            "is_imminent": is_imminent,
            "upcoming_events": imminent_events,
            "asof_used": asof_date.strftime("%Y-%m-%d")
        }

    def prepare_tensor_data(self, df):
        """
        Converts DataFrame to PyTorch tensors.
        """
        # ... logic to normalize and reshape for LSTM/Transformer ...
        pass
