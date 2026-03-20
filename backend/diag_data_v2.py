from data_ingestion import DataIngestion
import asyncio
import yfinance as yf

async def test():
    ingestor = DataIngestion()
    tickers = ["7203", "AAPL", "BTC-USD"]
    for t in tickers:
        try:
            print(f"\n--- Testing {t} ---")
            # Raw test
            full_ticker = f"{t}.T" if t.isdigit() else t
            stock = yf.Ticker(full_ticker)
            df_raw = stock.history(period="5d")
            print(f"Raw yfinance period='5d' len: {len(df_raw)}")
            if not df_raw.empty:
                print(df_raw.tail(1))
            
            # Ingestor test
            df = ingestor.fetch_stock_data(t, period="5d")
            print(f"Ingestor fetch_stock_data len: {len(df)}")
        except Exception as e:
            print(f"Error testing {t}: {e}")

if __name__ == "__main__":
    asyncio.run(test())
