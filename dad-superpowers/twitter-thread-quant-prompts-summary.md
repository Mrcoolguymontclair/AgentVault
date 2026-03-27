# Ten Quant Prompts, One Big Story

This file summarizes a Twitter thread by Jason Luongo (`@JasonL_Capital`) that pitches 10 prompts for turning Claude into a "retail quant desk."

The prompts are framed with institutional labels:

- Renaissance Technologies - backtesting
- Two Sigma - position sizing
- Citadel - market regime classification
- D.E. Shaw - correlation and hidden portfolio risk
- AQR - factor exposure
- Bridgewater - macro environment read
- Jane Street - options pricing and IV analysis
- Point72 - earnings-event setup analysis
- Virtu - execution optimization
- Millennium - performance review

There is also a bonus suggestion to connect live market data through an API so the prompts work with real numbers instead of estimates.

## The Short Version

This thread is trying to do one thing:

turn Claude into a **retail investor's quant desk**.

The key insight is not "AI can predict the market."

It is:

**AI can help ordinary investors think more like a professional trading team.**

The thread tries to force better habits:

- test before trading
- size positions rationally
- identify the market regime
- understand portfolio correlation risk
- measure factor exposure
- read macro context
- price options more carefully
- evaluate earnings trades mathematically
- improve trade execution
- and measure performance honestly

Put even more simply:

- Prompt 1 says: "Don't trade untested ideas."
- Prompt 2 says: "Don't blow yourself up."
- Prompt 3 says: "Know what kind of market you're in."
- Prompt 4 says: "Your portfolio may be riskier than it looks."
- Prompt 5 says: "Your returns are driven by hidden factors."
- Prompt 6 says: "Macro conditions change what should work."
- Prompt 7 says: "An option can be the right idea at the wrong price."
- Prompt 8 says: "Earnings trades should be judged by math, not excitement."
- Prompt 9 says: "Bad execution quietly taxes every trade."
- Prompt 10 says: "If you don't measure performance well, you won't improve."

## The Big Idea

A lot of retail investors still make decisions in a loose, intuitive way.

They ask:

- "Do I like this stock?"
- "Does this chart look good?"
- "Do I think this will go up?"

This thread tries to replace that with a more structured process.

Instead of asking, "Do I feel good about this trade?", it asks:

- Has this idea worked historically?
- How much should I risk if I'm wrong?
- What kind of market am I in right now?
- Are my positions all really just the same bet in disguise?
- What factor or macro exposure am I actually carrying?
- Is this option expensive or cheap?
- Does the event math justify the trade?
- Am I getting killed by bad fills?
- What does my actual performance data say?

That is the real value of the thread.

It is trying to move someone from **stock picker mode** into **portfolio and risk-manager mode**.

## Prompt 1: The Renaissance Technologies Backtesting Framework

### What it is

This prompt asks Claude to help build a simple backtesting workflow for a specific strategy.

### Main message

Before you risk real money, test whether the strategy actually works.

### What it does well

It does not just ask for a backtest. It asks for a **realistic** backtest.

It explicitly asks for:

- historical data sources
- transaction costs
- slippage
- train/test separation
- key performance metrics
- comparison against SPY buy-and-hold
- simple Python code
- and an honest conclusion if the strategy fails

That last part is especially strong. It tries to prevent Claude from becoming a cheerleader.

### What a smart reader should notice

This prompt is basically about fighting self-deception.

A lot of amateur backtests are just curve-fitting machines. This prompt is better because it asks for:

- a baseline
- realism
- out-of-sample thinking
- and permission to say "this strategy is not good"

## Prompt 2: The Two Sigma Position Sizing Calculator

### What it is

This prompt is about building a position-sizing system based on account size, strategy type, and max acceptable drawdown.

### Main message

Even a good strategy can fail if the bet size is reckless.

### What it is trying to do

It shifts the focus from "What should I buy?" to "How big should I bet?"

That is a more mature question.

Retail traders often obsess over entries and ignore sizing. But sizing is often what determines survival.

### Why it matters

This prompt is trying to turn risk management into a first-class decision.

That is very quant-like.

## Prompt 3: The Citadel Market Regime Classifier

### What it is

This prompt asks Claude to classify the current market regime using indicators like SPY relative to moving averages and VIX context.

### Main message

A strategy does not mean much without context.

### What it is really saying

Before you trade, ask:

"Is this a trending market, a choppy market, a fearful market, or a calm market?"

That is a regime question.

And that is smart because many strategies only work in certain environments.

### Why it matters

This prompt brings in the idea that markets are not always the same game.

That is a professional-level insight.

## Prompt 4: The D.E. Shaw Correlation Scanner

### What it is

This prompt asks Claude to analyze hidden portfolio risk: correlation, sector overlap, beta, drawdown sensitivity, and risk contribution.

### Main message

Your portfolio may look diversified while actually being one big bet.

### What it does well

This is one of the strongest prompts in the set because it targets a very common investor blind spot.

Many people think owning many stocks means diversification. But if they all depend on the same macro forces, they may all fall together.

This prompt asks Claude to uncover:

- correlated positions
- hidden sector concentration
- portfolio beta
- selloff sensitivity
- marginal risk contribution
- what to cut first

### Why it matters

This prompt most directly forces portfolio-level thinking.

## Prompt 5: The AQR Factor Exposure Analyzer

### What it is

This prompt asks Claude to break a portfolio into factor exposures like growth, value, momentum, quality, and rate sensitivity.

### Main message

Your returns are often driven by factors underneath the stocks, not just by the ticker symbols.

### What it is trying to reveal

This prompt says:

"You may think you own five different companies, but maybe you really just own one giant growth bet."

That is a very useful lens.

### Why it matters

This prompt helps someone understand what macro or style rotation would hurt them most.

That is more sophisticated than simply asking whether each stock is "good."

## Prompt 6: The Bridgewater Macro Trading Dashboard

### What it is

This prompt asks Claude to build a compact macro read using current rates, the dollar, volatility, Fed expectations, and major upcoming data releases.

### Main message

Before making a new allocation, understand the **macro weather**.

### What it is trying to do

This prompt is less about stock selection and more about building a daily environment check.

It asks:

- Are rates rising or falling?
- Is the dollar strengthening or weakening?
- Is volatility elevated?
- Is a major macro event close?
- Should I be aggressive or conservative right now?

### Why it matters

This is useful because many portfolios fail not because the stock thesis was silly, but because the investor ignored the larger environment.

A growth-heavy portfolio behaves very differently in:

- falling rates and low volatility
- versus rising yields and macro fear

This prompt tries to make that context explicit.

## Prompt 7: The Jane Street Options Pricing Analyzer

### What it is

This prompt asks Claude to evaluate whether an option contract is cheap, expensive, or fair based on implied volatility, theoretical value, intrinsic vs time value, theta decay, and IV-crush risk.

### Main message

An option can be the right directional idea and still be a bad trade if the price is wrong.

### What it does well

This is one of the more concrete and practical prompts because it focuses on **price quality**, not just the trade idea.

It asks Claude to evaluate:

- relative IV
- theoretical value
- intrinsic vs extrinsic value
- theta loss per day
- IV-crush impact

That is a much better way to think about options than simply asking "Should I buy this call?"

### Why it matters

This prompt encourages the user to think like an options desk:

not just "Do I like the stock?" but "Am I paying too much for this convexity?"

## Prompt 8: The Point72 Earnings Edge Analyzer

### What it is

This prompt asks Claude to study a company's earnings history, implied move, realized move vs implied move, and whether selling premium into earnings is mathematically attractive.

### Main message

Earnings should be treated like an event-volatility problem, not a gambling opportunity.

### What it does well

This prompt is strong because it tries to force a disciplined event-trading mindset.

It asks for:

- past earnings beats/misses
- stock reaction patterns
- current implied move
- realized vs implied move history
- whether IV is rich enough to justify selling premium
- and whether the right answer is actually to skip the trade

That last part matters a lot. It gives Claude permission to say, "There is no edge here."

### Why it matters

Retail traders often get pulled into earnings because the move is exciting. This prompt tries to reframe earnings as a question of **event pricing**:

Is premium overpriced, underpriced, or fair?

## Prompt 9: The Virtu Execution Optimizer

### What it is

This prompt asks Claude to help improve order placement, timing, and fill quality for options or stock trades.

### Main message

Bad execution quietly taxes every trade.

### What it is trying to do

This prompt focuses on something many investors ignore: even a good idea loses value if it is entered badly.

It asks about:

- limit orders vs market orders
- where to place a limit order
- best time of day for fills
- the percentage cost of the bid-ask spread
- how wide spreads really affect premium collection
- which order duration to use

### Why it matters

This is very desk-like thinking.

A lot of nonprofessionals treat execution as an afterthought, but execution quality is basically a hidden fee on every trade.

This prompt is especially useful because it turns that invisible cost into something measurable.

## Prompt 10: The Millennium Performance Dashboard

### What it is

This prompt asks Claude to analyze a log of past trades and build a real performance report.

### Main message

If you do not measure your behavior honestly, you will not improve.

### What it does well

This prompt is excellent because it shifts the conversation from market opinion to process review.

It asks for:

- total return
- annualized return
- win rate
- average winner vs loser
- profit factor
- max drawdown
- best and worst trades
- performance by strategy type
- and direct advice on what to do more of or stop doing

It also includes the very useful phrase:

"Be brutally honest."

Again, that helps counter the tendency of language models to sound encouraging instead of diagnostic.

### Why it matters

This prompt basically turns Claude into a trading coach or post-trade reviewer.

And in many cases, that is more valuable than another trade idea.

## Bonus: Live Data Makes Everything Better

The thread ends with a practical suggestion:

these prompts become much more useful if Claude has live quotes, option chains, Greeks, and portfolio data.

That is true.

Many of the prompts are structurally strong, but their value rises sharply when the model can operate on:

- current prices
- current IV
- real holdings
- actual upcoming macro events
- and recent account performance

Without live data, Claude is mostly a framework and reasoning assistant.

With live data, it starts to become a real analysis layer.

## What Is Especially Clever or Novel Here?

There are some genuinely clever construction choices, even though the underlying finance concepts are mostly standard.

### 1. The prompts are framed as institutional roles

Using names like:

- Renaissance
- Two Sigma
- Citadel
- D.E. Shaw
- AQR
- Bridgewater
- Jane Street
- Point72
- Virtu
- Millennium

is not technically necessary, but it is psychologically powerful.

Each firm name acts like shorthand for a style of thinking:

- Renaissance = rigorous backtesting
- Two Sigma = systemized risk and sizing
- Citadel = regime/context awareness
- D.E. Shaw = hidden structure and portfolio risk
- AQR = factor decomposition
- Bridgewater = macro top-down read
- Jane Street = options pricing discipline
- Point72 = event-driven opportunism
- Virtu = execution quality
- Millennium = PM-style performance review

That is clever because it helps the model and the user snap into a mode quickly.

### 2. The prompts ask for decision-grade outputs, not vague commentary

These are not "tell me about markets" prompts.

They ask for things like:

- Sharpe ratio
- max drawdown
- portfolio beta
- factor exposure
- implied move
- Black-Scholes value
- theta decay
- IV crush
- execution slippage
- performance by strategy type

That pushes the model toward operational answers rather than generic financial writing.

### 3. The prompts include anti-BS clauses

This is one of the strongest design choices in the whole thread.

Examples:

- "If the strategy doesn't beat buy and hold, tell me."
- "Don't sugarcoat it."
- "If it's a coin flip, tell me to skip it."
- "Be brutally honest."

LLMs often default to being agreeable and overly polished. These lines try to counter that tendency directly.

### 4. The thread follows a professional workflow order

The prompts roughly follow the logic of how a real desk might think:

1. test the idea
2. size the risk
3. classify the regime
4. inspect portfolio risk
5. decompose factor exposure
6. read the macro environment
7. price the option correctly
8. evaluate event math
9. optimize execution
10. review performance

That sequence is more intelligent than any one prompt by itself.

### 5. The prompts mix quant rigor with retail usability

The prompts ask for sophisticated ideas, but in accessible language.

For example, the first prompt explicitly asks for code that someone can copy and paste even if they are not a developer.

That is good prompt design because it adapts the output to the user's practical level.

## What Is Not Actually Novel?

The packaging is clever.

The underlying quant ideas are mostly not new.

These are standard building blocks:

- backtesting
- Kelly sizing
- regime classification
- correlation analysis
- factor exposure analysis
- macro dashboarding
- options pricing
- event-volatility analysis
- execution optimization
- performance review

So I would say:

- **novel as finance research?** No, mostly standard.
- **novel as prompt packaging for retail users?** Yes, definitely somewhat clever.

## The Deepest Trick in the Thread

The deepest trick is that the prompts are not mainly trying to make Claude a "stock picker."

They are trying to make Claude play **different jobs inside a quant shop**.

Instead of one generic analyst prompt, the thread breaks the problem into roles:

- researcher
- risk manager
- regime analyst
- portfolio analyst
- factor analyst
- macro strategist
- options pricing analyst
- event trader
- execution trader
- performance reviewer

That is the most structurally intelligent part.

## The Deepest Shared Lesson

All 10 prompts reject the fantasy that good trading is just about finding the next good stock.

Instead, the thread says:

- trading ideas need testing
- risk needs sizing
- context matters
- hidden concentration matters
- factor exposure matters
- macro conditions matter
- price matters
- event math matters
- execution matters
- and review matters

That is a much more mature framework than simple stock picking.

## Final Takeaway

If I had to summarize the whole thread in one sentence, I would say:

**It turns Claude from a market commentator into a checklist-driven quant assistant.**

And the cleverest part is not the Wall Street branding.

It is that the prompts are designed to force better investor behavior:

- test first
- size carefully
- respect regime
- look for hidden risk
- understand factor exposure
- read macro context
- price options properly
- demand an event edge
- execute carefully
- and review performance honestly

That is real value.
