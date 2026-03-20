from data_ingestion import DataIngestion
import asyncio

async def test():
    ingestor = DataIngestion()
    tickers = ["7203", "AAPL", "BTC-USD"]
    for t in tickers:
        try:
            print(f"Testing {t}...")
            df = ingestor.fetch_stock_data(t, period="5d")
            print(f"  Success! len={len(df)}")
            print(df.tail(2))
        except Exception as e:
            print(f"  Failed {t}: {e}")

if __name__ == "__main__":
    asyncio.run(test())
