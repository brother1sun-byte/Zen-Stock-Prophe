import yfinance as yf

def check_ticker(ticker):
    print(f"Checking ticker: {ticker}")
    t = yf.Ticker(ticker)
    hist = t.history(period="1d")
    if hist.empty:
        print(f"Result: Empty for {ticker}")
    else:
        print(f"Result: Found data for {ticker}")
        print(hist.head())

if __name__ == "__main__":
    check_ticker("8306.T")
    check_ticker("830.T")
    check_ticker("830")
