import MetaTrader5 as mt5
import sys, json

symbol = sys.argv[1]
side = sys.argv[2]
entry = float(sys.argv[3])
sl = float(sys.argv[4])
tp = float(sys.argv[5])

if not mt5.initialize():
    print("MT5 initialize failed")
    sys.exit(1)

if not mt5.symbol_select(symbol, True):
    for alt in [symbol + ".a", "GOLD", "XAUUSD.a"]:
        if mt5.symbol_select(alt, True):
            symbol = alt
            break

order_type = mt5.ORDER_TYPE_BUY_LIMIT if side == "BUY" else mt5.ORDER_TYPE_SELL_LIMIT

request = {
    "action": mt5.TRADE_ACTION_PENDING,
    "symbol": symbol,
    "volume": 0.01,
    "type": order_type,
    "price": entry,
    "sl": sl,
    "tp": tp,
    "magic": 20240520,
    "comment": "ICT Institutional",
    "type_time": mt5.ORDER_TIME_GTC,
}

result = mt5.order_send(request)
print(json.dumps({"symbol": symbol, "result": str(result)}))
mt5.shutdown()
