# 151 Trading Strategies - Agent Playbook

This file is an implementation-oriented extraction of the paper in `ssrn-3247865.pdf`.
It is written for systematic agents, so each entry focuses on what to trade, how to trigger it, how to size or hedge it, and what usually breaks it.

Coverage note:
- This follows the paper's main strategy sections and folds minor sub-variants into the nearest parent entry when useful.
- It includes `3.10 Mean-reversion - weighted regression`, which is formatted as a section in the PDF even though the word `Strategy` is omitted there.
- It excludes `17.2 Money laundering` and `17.6 Loan sharking` because they are illegal or non-deployable for a legitimate trading system.
- It also includes a final addendum with 4 follow-up strategy ideas extracted from later research PDFs in the same folder. Those 4 are not part of the original 151 paper.

General implementation defaults:
- Use only liquid underlyings with borrow availability, tight spreads, and reliable corporate-action handling.
- Vol-target all positions. A practical default is to size each strategy sleeve to the same ex-ante daily risk, then cap gross and net exposure at the portfolio level.
- For long/short books, rebalance on the schedule stated for the signal, but add hard turnover caps and minimum signal thresholds so the agents do not churn.
- For option structures, use listed contracts with enough open interest, avoid earnings unless the strategy explicitly wants event risk, and convert every spread into max-profit / max-loss / Greeks before trading.
- For futures and swaps, track roll calendars, financing, margin usage, and counterparty terms as first-class state.

Common options notation:
- Unless noted otherwise, all legs share the same underlying and expiration.
- `K1 < K2 < K3 < K4` are strikes.
- Use 30-60 DTE for income trades, 45-90 DTE for long-volatility trades, and roll or close early if the remaining edge is mostly gone.

## Options (56)

### 2.2 Covered call
- Trade: long 100 shares, short 1 OTM call, usually 20-35 delta.
- Run: enter when view is neutral to mildly bullish; harvest option decay by rolling monthly or after 50% premium capture.
- Risk: downside is still mostly long-equity risk; upside is capped at strike plus premium.

### 2.3 Covered put
- Trade: short 100 shares, short 1 OTM put.
- Run: use only in liquid names with easy borrow; collect put premium while expressing a neutral-to-bearish view.
- Risk: losses are unbounded if the stock squeezes higher; borrow cost and recalls matter.

### 2.4 Protective put
- Trade: long stock plus long ATM or OTM put.
- Run: use when bullish but wanting a hard floor; finance part of the put cost by choosing a lower strike or shorter tenor.
- Risk: insurance drag is persistent; the strategy wins only if upside beats the option bleed.

### 2.5 Protective call
- Trade: short stock plus long ATM or OTM call.
- Run: use when bearish but needing upside disaster protection, especially in hard-to-borrow names.
- Risk: borrow cost plus option premium can overwhelm alpha if the stock just drifts sideways.

### 2.6 Bull call spread
- Trade: buy lower-strike call `K1`, sell higher-strike call `K2`.
- Run: use as a defined-risk bullish view when expecting a moderate rally into a target zone near `K2`.
- Risk: gains cap at `K2`; long premium decays if the move is late.

### 2.7 Bull put spread
- Trade: sell higher-strike put `K2`, buy lower-strike put `K1`.
- Run: use for a bullish or support-holds view; prefer high implied volatility and take profits early on credit decay.
- Risk: gap-down losses can hit the full spread width minus premium.

### 2.8 Bear call spread
- Trade: sell lower-strike call `K1`, buy higher-strike call `K2`.
- Run: use when expecting price to stay below resistance; best when implied vol is rich and skew is favorable.
- Risk: upside is defined but sharp rallies can push the spread to max loss quickly.

### 2.9 Bear put spread
- Trade: buy higher-strike put `K2`, sell lower-strike put `K1`.
- Run: use for a measured downside move when outright long puts are too expensive.
- Risk: profit is capped below `K1`; theta hurts if the drop takes too long.

### 2.10 Long synthetic forward
- Trade: long call and short put at the same strike and expiry.
- Run: use when you want forward-like bullish exposure without holding spot; compare synthetic carry against actual financing.
- Risk: identical directional risk to a levered long forward; assignment and borrow mechanics still matter.

### 2.11 Short synthetic forward
- Trade: long put and short call at the same strike and expiry.
- Run: use for forward-like bearish exposure when options are cheaper or easier than shorting stock directly.
- Risk: effectively an unbounded short if the underlying runs away.

### 2.12 Long combo
- Trade: long OTM call at `K1`, short OTM put at `K2`, with `K1 > K2`.
- Run: this is a bullish risk-reversal; use when upside convexity is wanted and the desk is willing to own the downside below `K2`.
- Risk: premium can be small, but downside behaves like a synthetic long below the put strike.

### 2.13 Short combo
- Trade: long OTM put at `K1`, short OTM call at `K2`, with `K2 > K1`.
- Run: this is a bearish risk-reversal; use when expecting downside and wanting the long put partly financed by short call premium.
- Risk: upside is effectively unbounded above the short call strike.

### 2.14 Bull call ladder
- Trade: long call `K1`, short call `K2`, short call `K3`.
- Run: use when mildly bullish or expecting the price to settle around `K2`; it is a call spread financed by selling extra upside.
- Risk: above `K3` the naked extra short call creates large losses.

### 2.15 Bull put ladder
- Trade: short put `K3`, short put `K2`, long put `K1`.
- Run: use when bullish-to-neutral and wanting to collect credit while accepting some downside tail risk.
- Risk: if price collapses below the lower wing, losses expand because there are more short puts than long puts.

### 2.16 Bear call ladder
- Trade: short call `K1`, short call `K2`, long call `K3`.
- Run: use when bearish-to-neutral and expecting price to stay below the middle strikes.
- Risk: losses can still be large through the short-call zone before the long wing helps.

### 2.17 Bear put ladder
- Trade: long put `K3`, short put `K2`, short put `K1`.
- Run: use when expecting a modest decline, not a crash; it monetizes the area around the middle strike.
- Risk: too much downside can overwhelm the single long put.

### 2.18 Calendar call spread
- Trade: sell near-term call, buy longer-dated call at the same strike.
- Run: use when expecting near-term pinning and later upside; pick a strike near expected settlement.
- Risk: early large moves or implied-vol crush in the back month can hurt both legs.

### 2.19 Calendar put spread
- Trade: sell near-term put, buy longer-dated put at the same strike.
- Run: use when expecting quiet near-term trading with later downside risk.
- Risk: a fast selloff before the front expiry can create short-gamma pain.

### 2.20 Diagonal call spread
- Trade: sell shorter-dated call and buy longer-dated call at a different strike.
- Run: use when you want calendar exposure plus a directional call view; common setup is long lower-strike back-month call versus short higher-strike front-month call.
- Risk: shape risk is high because strike and tenor both differ; manage Greeks, not just payoff-at-expiry.

### 2.21 Diagonal put spread
- Trade: sell shorter-dated put and buy longer-dated put at a different strike.
- Run: use when expecting a gradual bearish path rather than a one-day crash.
- Risk: front-leg gamma can dominate during a fast drawdown.

### 2.22 Long straddle
- Trade: buy ATM call and ATM put.
- Run: use when expecting a large move but not knowing direction, such as before catalysts with underpriced vol.
- Risk: both options decay quickly; realized move must exceed implied move plus costs.

### 2.23 Long strangle
- Trade: buy OTM call and OTM put.
- Run: cheaper than a straddle; use when expecting a very large move or vol expansion.
- Risk: needs a bigger move than the straddle because both strikes are farther away.

### 2.24 Long guts
- Trade: buy ITM call and ITM put.
- Run: use as a high-delta long-volatility structure when expecting a large move and wanting more intrinsic than a strangle.
- Risk: higher debit and wider capital at risk than a strangle.

### 2.25 Short straddle
- Trade: sell ATM call and ATM put.
- Run: use only when implied vol is rich, the event calendar is clean, and the system can monitor gamma intraday.
- Risk: losses are theoretically unlimited on the upside and severe on the downside.

### 2.26 Short strangle
- Trade: sell OTM call and OTM put.
- Run: use as a lower-probability, lower-credit version of the short straddle; best in range-bound regimes.
- Risk: tail losses remain large if price breaks out of the range.

### 2.27 Short guts
- Trade: sell ITM call and ITM put.
- Run: use only when extremely confident realized volatility will stay low and the desk can warehouse directional risk.
- Risk: assignment and path risk are worse than in a standard short strangle.

### 2.28 Long call synthetic straddle
- Trade: short stock and buy two calls at the same strike.
- Run: this replicates a long straddle with a synthetic put; useful when put markets are illiquid or rich relative to call markets.
- Risk: short-stock borrow and squeeze risk sit underneath the volatility trade.

### 2.29 Long put synthetic straddle
- Trade: long stock and buy two puts at the same strike.
- Run: this replicates a long straddle with a synthetic call; useful when calls are unavailable or expensive.
- Risk: long stock plus long puts ties up capital and suffers if price goes nowhere.

### 2.30 Short call synthetic straddle
- Trade: long stock and short two calls.
- Run: use as a synthetic short straddle with a bullish carry bias; best when expecting the stock to stay near the strike.
- Risk: downside on the stock is large and upside is overcapped by two short calls.

### 2.31 Short put synthetic straddle
- Trade: short stock and short two puts.
- Run: synthetic short straddle with a bearish carry bias; only for very controlled books.
- Risk: upside squeeze and downside gap can both be painful through different legs.

### 2.32 Covered short straddle
- Trade: covered call plus an extra short put at the same strike.
- Run: use when bullish enough to own stock and willing to add more on weakness in exchange for more premium.
- Risk: concentrated downside because the stock falls while the short put expands.

### 2.33 Covered short strangle
- Trade: covered call plus an extra short OTM put.
- Run: use when wanting income with a wider downside assignment zone than a same-strike short straddle.
- Risk: still carries large downside if the stock sells through the put strike.

### 2.34 Strap
- Trade: buy two calls and one put at the same strike.
- Run: use when expecting a big move with upside more likely than downside.
- Risk: expensive long-vol structure that still needs realized movement.

### 2.35 Strip
- Trade: buy one call and two puts at the same strike.
- Run: use when expecting a big move with downside more likely than upside.
- Risk: same long-vol premium drag as the strap, but with bearish skew.

### 2.36 Call ratio backspread
- Trade: sell one lower-strike call, buy more higher-strike calls.
- Run: use when expecting an explosive upside move and wanting small or zero initial debit.
- Risk: worst losses occur if price expires near the short strike region.

### 2.37 Put ratio backspread
- Trade: sell one higher-strike put, buy more lower-strike puts.
- Run: use when expecting a crash and wanting convex downside exposure.
- Risk: moderate declines can lose money before the extra long puts dominate.

### 2.38 Ratio call spread
- Trade: long one lower-strike call, short more higher-strike calls.
- Run: use when expecting a limited upside move into a target band.
- Risk: too much upside leaves net short calls.

### 2.39 Ratio put spread
- Trade: long one higher-strike put, short more lower-strike puts.
- Run: use when expecting a controlled decline, not a collapse.
- Risk: a deep selloff leaves the book net short downside convexity.

### 2.40 Long call butterfly
- Trade: long call `K1`, short two calls `K2`, long call `K3`, usually symmetric.
- Run: use when expecting price to expire near `K2`; enter for a small debit when implied vol is not too high.
- Risk: max gain occurs only near the body strike; otherwise most of the debit decays away.

### 2.41 Long put butterfly
- Trade: long put `K3`, short two puts `K2`, long put `K1`.
- Run: same directional profile as the call butterfly but sometimes with better pricing or assignment behavior.
- Risk: narrow profit tent; path matters if early exercise is possible.

### 2.42 Short call butterfly
- Trade: short call butterfly, or equivalently the opposite of the long call butterfly.
- Run: use when expecting a large move away from `K2` and wanting short premium near the body.
- Risk: max loss occurs if price pins near the middle strike.

### 2.43 Short put butterfly
- Trade: short put butterfly, the opposite of the long put butterfly.
- Run: use when expecting realized volatility to exceed what the butterfly price implies.
- Risk: largest loss happens if expiry lands near the center strike.

### 2.44 Long iron butterfly
- Trade: short ATM straddle plus long OTM wings.
- Run: use as a defined-risk short-volatility trade when expecting low realized movement around the middle strike.
- Risk: still loses if price drifts too far from center; only the wings cap tail risk.

### 2.45 Short iron butterfly
- Trade: long ATM straddle plus short OTM wings.
- Run: use as a cheaper defined-risk long-volatility trade around a central strike.
- Risk: if realized move is small, both long options decay faster than the wings offset.

### 2.46 Long call condor
- Trade: long call `K1`, short call `K2`, short call `K3`, long call `K4`.
- Run: use when expecting price to settle inside a wider range than a butterfly; choose `K2-K3` as the target zone.
- Risk: profit is capped and only realized if expiry stays within the inner strikes.

### 2.47 Long put condor
- Trade: same shape as the call condor but using puts.
- Run: use when put skew or borrow constraints make the put version more attractive than the call version.
- Risk: narrow payoff zone versus premium paid.

### 2.48 Short call condor
- Trade: opposite of the long call condor.
- Run: use when expecting a larger-than-priced move out of the inner range.
- Risk: loss peaks if price settles inside the short region.

### 2.49 Short put condor
- Trade: opposite of the long put condor.
- Run: same intent as the short call condor, but sourced from put markets.
- Risk: pin risk near the inner strikes is the main enemy.

### 2.50 Long iron condor
- Trade: short OTM put spread plus short OTM call spread, with wider long wings.
- Run: use as a range-bound premium-selling structure with defined tails; common on indexes.
- Risk: profits are modest and tail moves can still consume the full spread width.

### 2.51 Short iron condor
- Trade: long OTM put spread plus long OTM call spread.
- Run: use when expecting a breakout but wanting to reduce the cost of a long strangle.
- Risk: if price stays between the shorts, time decay erodes both spreads.

### 2.52 Long box
- Trade: combine bull call spread and bear put spread with the same strikes.
- Run: this synthetically locks in a fixed payoff; use only when option prices imply a financing edge versus rates.
- Risk: real-world edge is usually tiny and can disappear after fees, funding, and exercise frictions.

### 2.53 Collar
- Trade: long stock, long protective put, short covered call.
- Run: use to hold equity exposure inside a predefined floor and cap; common for tax-sensitive holders.
- Risk: upside is sold away and poor strike selection can make the hedge expensive.

### 2.54 Bullish short seagull spread
- Trade: bullish call spread financed by selling a downside put.
- Run: use when mildly bullish and willing to buy weakness below the put strike for better upfront economics.
- Risk: downside tail behaves like a short put.

### 2.55 Bearish long seagull spread
- Trade: bearish put spread augmented with a short upside call.
- Run: use when bearish and willing to give up upside beyond a cap to reduce put-cost outlay.
- Risk: sharp upside rallies hurt through the short call.

### 2.56 Bearish short seagull spread
- Trade: credit-style bearish structure combining short puts and calls with one long wing.
- Run: use when expecting price to drift lower or stay below a resistance zone.
- Risk: depending on strike selection, one tail can remain only partially hedged.

### 2.57 Bullish long seagull spread
- Trade: debit-style bullish structure that combines a call spread with a short lower-strike put.
- Run: use when expecting moderate upside and being comfortable taking stock synthetically on a dip.
- Risk: downside is worse than a plain call spread because of the short put.

## Stocks (20)

### 3.1 Price-momentum
- Trade: rank stocks by cumulative past return over a formation window, usually 6-12 months, skipping the most recent month.
- Run: buy top decile or quintile, short bottom decile or quintile, rebalance monthly, and vol-scale weights.
- Risk: momentum crashes happen during violent factor reversals; cap sector and beta exposures.

### 3.2 Earnings-momentum
- Trade: rank by earnings surprise, analyst revision breadth, or post-earnings drift strength.
- Run: go long names with positive surprises and upward revisions, short names with negative surprises and downgrades.
- Risk: crowded post-earnings trades reverse hard when guidance or macro regime changes.

### 3.3 Value
- Trade: rank stocks by cheapness metrics such as book-to-market, earnings yield, free-cash-flow yield, or enterprise-value multiples.
- Run: buy the cheapest basket and short the richest basket, but neutralize sector composition so the book is not just a sector bet.
- Risk: value traps persist for long periods; combine with quality or momentum filters.

### 3.4 Low-volatility anomaly
- Trade: rank by trailing volatility or beta and buy the calmer names.
- Run: build a long-only low-vol sleeve or a market-neutral book long low-vol and short high-vol.
- Risk: low-vol books can load on rates, defensives, and crowding; guard against hidden duration risk.

### 3.5 Implied volatility
- Trade: use monthly changes in call and put implied volatility as predictors for stock returns.
- Run: buy stocks with the largest rise in call IV and short stocks with the largest rise in put IV, or rank by the call-IV minus put-IV change.
- Risk: options microstructure noise is high in illiquid names; filter by option volume and open interest.

### 3.6 Multifactor portfolio
- Trade: combine value, momentum, quality, size, low-vol, and similar factor sleeves.
- Run: either allocate capital across prebuilt factor books or blend standardized factor ranks into one composite score and trade the extremes.
- Risk: factor overlap creates accidental concentration; monitor factor exposures, sector tilts, and net beta explicitly.

### 3.7 Residual momentum
- Trade: regress returns on broad factors, then rank stocks by momentum in the residuals rather than raw returns.
- Run: estimate factor betas on a long lookback, compute residual returns on the formation window, buy the best residual trend and short the worst.
- Risk: unstable factor estimates can create false residuals; refresh betas slowly and shrink noisy names.

### 3.8 Pairs trading
- Trade: identify historically co-moving pairs and monitor spread divergence.
- Run: when the spread z-score exceeds a threshold, short the rich leg and buy the cheap leg; close when the spread mean-reverts.
- Risk: structural breaks kill pairs; require cointegration or persistent economic linkage, not just high correlation.

### 3.9 Mean-reversion - single cluster
- Trade: within one cluster such as a sector, demean stock returns versus the cluster average.
- Run: buy the relative losers and short the relative winners, usually for short holding periods from one day to one week.
- Risk: strong news-driven trends can keep winners winning; avoid earnings and major event dates.

### 3.10 Mean-reversion - weighted regression
- Trade: regress stock returns on industry and risk-factor loadings, then trade the weighted residuals.
- Run: use weights such as `1 / sigma^2` so volatile names do not dominate, then buy negative residual outliers and short positive residual outliers.
- Risk: regression design defines the alpha; bad loadings turn the strategy into an unpriced factor bet.

### 3.11 Single moving average
- Trade: compare current price to one moving average.
- Run: go long when price rises above the MA and short when it falls below; this is a simple time-series trend system.
- Risk: whipsaws in sideways markets are constant; add volatility or breakout filters.

### 3.12 Two moving averages
- Trade: compare a short MA to a long MA.
- Run: buy on bullish crossover, short on bearish crossover, and optionally add a stop such as a 2% adverse move from prior close.
- Risk: crossover lag can give back much of the move before exit.

### 3.13 Three moving averages
- Trade: require `MA(T1) > MA(T2) > MA(T3)` for longs and the reverse for shorts.
- Run: use this as a stricter trend filter to suppress false signals from two-line crossovers.
- Risk: better signal quality comes at the cost of slower entries and exits.

### 3.14 Support and resistance
- Trade: compute pivot, support, and resistance levels from the prior day's high, low, and close.
- Run: buy above the pivot and exit into resistance, or short below the pivot and cover into support.
- Risk: breakout days invalidate range logic; add volume confirmation or stop levels.

### 3.15 Channel
- Trade: use price channels such as Donchian highs and lows.
- Run: either fade touches of the floor and ceiling in range regimes or switch to breakout-following once price closes through the boundary on volume.
- Risk: channel strategies fail when the regime assumption is wrong; the system must classify range versus trend.

### 3.16 Event-driven - M&A
- Trade: long the target in cash deals, or long target and short acquirer by the deal ratio in stock deals.
- Run: model spread to consideration, expected close date, borrow cost, and estimated break price; size by expected value, not just spread width.
- Risk: deal breaks dominate P&L; antitrust, financing, shareholder votes, and regulatory windows matter more than chart signals.

### 3.17 Machine learning - single-stock KNN
- Trade: forecast next-horizon return using technical features from the same stock only, then trade by nearest-neighbor prediction.
- Run: build normalized features from price and volume windows, select `k`, predict the future return from historical nearest neighbors, and buy or short only when the predicted move exceeds costs.
- Risk: overfitting is easy; keep training strictly out of sample and retrain on a rolling window.

### 3.18 Statistical arbitrage - optimization
- Trade: estimate expected returns `E` and covariance `C`, then optimize holdings rather than ranking heuristically.
- Run: solve for a constrained long/short portfolio such as `w ~ C^-1 E` under turnover, position, beta, sector, and liquidity limits.
- Risk: the optimizer amplifies bad forecasts; shrink alphas and covariance aggressively.

### 3.19 Market-making
- Trade: quote both sides around fair value and earn spread plus inventory alpha.
- Run: skew quotes by inventory, adverse-selection estimates, queue position, and short-term alpha; widen quotes in volatile or toxic flow regimes.
- Risk: market-making dies from inventory runaway and informed flow; hard kill-switches are mandatory.

### 3.20 Alpha combos
- Trade: combine many weak alphas into one executable stock book.
- Run: normalize each alpha, forecast expected return per name, blend with weights based on historical information ratio and correlation, then optimize the final book.
- Risk: if alpha correlation rises in stress, a supposedly diversified combo can collapse into one crowded trade.

## Exchange-Traded Funds (6)

### 4.1 Sector momentum rotation
- Trade: rank sector ETFs by 6-12 month cumulative return and rotate into leaders.
- Run: buy the top decile or top few sectors for 1-3 months; optional variants from the paper include an MA filter and dual momentum against a broad-market ETF.
- Risk: fast sector reversals are common near macro turning points; use trend filters and rebalance discipline.

### 4.2 Alpha rotation
- Trade: replace raw momentum with ETF alpha from factor regressions such as Fama-French.
- Run: estimate rolling alpha, buy ETFs with the strongest positive alpha, and rotate periodically.
- Risk: alpha estimates are noisy over short windows; avoid overreacting to one-quarter artifacts.

### 4.3 R-squared
- Trade: combine alpha with factor-model `R^2` or `1 - R^2` as a selectivity measure.
- Run: favor ETFs with high alpha and low `R^2`, and short ETFs with low alpha and high `R^2`; the paper suggests a two-stage sort.
- Risk: low `R^2` can also mean noisy exposure, not skill; pair it with liquidity and persistence checks.

### 4.4 Mean-reversion
- Trade: rank ETFs cross-sectionally by Internal Bar Strength, `IBS = (close - low) / (high - low)`.
- Run: short the highest-IBS ETFs and buy the lowest-IBS ETFs, usually for a short holding period.
- Risk: strong trends can overwhelm the signal, especially in leveraged or commodity ETFs.

### 4.5 Leveraged ETFs (LETFs)
- Trade: short both a leveraged ETF and its leveraged inverse ETF on the same underlying.
- Run: exploit volatility drag and daily rebalance decay, often parking proceeds in a Treasury ETF.
- Risk: short-term trends can make one leg explode faster than the other decays; size conservatively and monitor borrow.

### 4.6 Multi-asset trend following
- Trade: hold a diversified long-only basket of ETFs with positive medium-term momentum.
- Run: keep only ETFs with positive cumulative return, optionally above long-term MA, then weight by raw momentum, momentum over vol, or momentum over variance.
- Risk: correlations jump in crises, so apparent diversification vanishes exactly when needed.

## Fixed Income (14)

### 5.2 Bullets
- Trade: concentrate exposure in one maturity bucket.
- Run: choose the maturity point with the most attractive yield, roll-down, or liability match and hold mainly that part of the curve.
- Risk: concentrated maturity exposure is vulnerable to local curve shifts.

### 5.3 Barbells
- Trade: hold short- and long-maturity bonds while avoiding the middle.
- Run: duration-match a bullet benchmark but own both wings to gain convexity.
- Risk: the convexity benefit comes with lower carry and higher exposure to nonparallel curve moves.

### 5.4 Ladders
- Trade: hold roughly equal capital across many evenly spaced maturities.
- Run: as short maturities roll off, reinvest into new long maturities to keep target duration stable and reinvestment staggered.
- Risk: ladders reduce concentration but still lose when yields rise broadly.

### 5.5 Bond immunization
- Trade: build a bond portfolio whose duration, and sometimes convexity, matches a future liability.
- Run: solve for holdings so portfolio present value and duration match the liability horizon, then rebalance as rates and time pass.
- Risk: immunization protects only approximately and mainly against small parallel shifts.

### 5.6 Dollar-duration-neutral butterfly
- Trade: long a barbell and short a bullet, with DV01 matched.
- Run: choose `T1 < T2 < T3`, then size the wings and body so total dollar duration is neutral while expressing a curvature view.
- Risk: it is not protected against slope or curvature changes going the wrong way.

### 5.7 Fifty-fifty butterfly
- Trade: butterfly with equal dollar durations in the two wings.
- Run: use when wanting more neutrality to small steepening or flattening around the body.
- Risk: it is no longer dollar-neutral, so financing and carry matter more.

### 5.8 Regression-weighted butterfly
- Trade: butterfly whose wing weights are set by historical spread-volatility relationships.
- Run: estimate the relative wing sensitivity `beta` from history, then size the wings so the curve bet is neutralized according to that beta.
- Risk: if the estimated beta shifts, the hedge becomes stale fast.

### 5.9 Low-risk factor
- Trade: favor lower-risk bonds, such as shorter-maturity investment-grade issues over riskier or longer-dated ones.
- Run: rank by maturity, rating, or spread volatility; buy the safer decile and, if allowed, short the riskier decile.
- Risk: in violent credit rallies, the high-beta junk leg can outperform sharply.

### 5.10 Value factor
- Trade: compare observed bond spread to a model-implied spread based on rating and maturity.
- Run: regress spreads on rating dummies and maturity, compute residual cheapness, and buy the bonds whose spreads are widest versus model.
- Risk: model misspecification can mistake genuine credit deterioration for value.

### 5.11 Carry factor
- Trade: buy bonds with the highest expected carry plus roll-down and short the lowest.
- Run: estimate carry from yield plus roll-down under a roughly stable curve assumption, then form a zero-cost decile spread.
- Risk: carry works until the curve reprices violently; funding and transaction costs can erase the edge.

### 5.12 Rolling down the yield curve
- Trade: buy bonds sitting on the steepest part of the curve and sell them as they age into lower-yield maturities.
- Run: repeatedly own medium- or long-term bonds where roll-down is largest, then recycle proceeds into fresh steep-curve bonds.
- Risk: if the curve shape changes instead of staying similar, expected roll-down disappears.

### 5.13 Yield curve spread (flatteners & steepeners)
- Trade: buy or sell the yield spread between short- and long-maturity bonds.
- Run: if expecting rates to fall and the curve to steepen, buy the spread; if expecting rising rates and flattening, short the spread; keep the trade DV01 neutral.
- Risk: parallel shifts and policy shocks can produce losses even if the macro view is partly right.

### 5.14 CDS basis arbitrage
- Trade: buy a bond and buy CDS protection when bond spread is wider than CDS spread, or unwind the reverse when basis is positive.
- Run: compute `CDS basis = CDS spread - bond spread`; negative basis means the bond is cheap relative to insurance.
- Risk: funding, repo availability, counterparty risk, and delivery mechanics often dominate the apparent arbitrage.

### 5.15 Swap-spread arbitrage
- Trade: long or short an interest-rate swap against a Treasury of the same maturity.
- Run: receive fixed in swap and short Treasury if swap spread is expected to widen or funding terms favor the package; reverse for tightening.
- Risk: this is also a bet on LIBOR or funding basis behavior, not just pure Treasury mispricing.

## Indexes (4)

### 6.2 Cash-and-carry arbitrage
- Trade: exploit deviations between index futures and fair value based on spot, dividends, and rates.
- Run: if futures are rich, short futures and buy the cash basket; if cheap, do the reverse, but only when basis exceeds fees and slippage.
- Risk: execution speed is everything and incomplete baskets create tracking error.

### 6.3 Dispersion trading in equity indexes
- Trade: long single-name volatility and short index volatility.
- Run: buy near-ATM straddles on constituents and short an index straddle sized so constituent notional roughly replicates the index.
- Risk: correlation can rise exactly when you are long dispersion, and option carry is expensive.

### 6.4 Intraday arbitrage between index ETFs
- Trade: exploit temporary mispricings between highly related ETFs tracking the same or overlapping indexes.
- Run: estimate real-time NAV or fair spread, buy the cheap ETF and short the rich ETF, then flatten once the spread normalizes.
- Risk: stale prints, basket illiquidity, and creation-redemption frictions can make apparent spreads fake.

### 6.5 Index volatility targeting with risk-free asset
- Trade: dynamically mix index exposure with cash or T-bills to maintain a target volatility.
- Run: estimate trailing realized vol; scale risky weight roughly as `target_vol / realized_vol`, parking the rest in the risk-free asset.
- Risk: vol spikes are backward-looking, so leverage is highest just before crashes unless caps are enforced.

## Volatility (5)

### 7.2 VIX futures basis trading
- Trade: mean-revert the basis between front VIX futures and spot VIX.
- Run: short front-month VIX futures in contango and buy them in backwardation, using daily roll value thresholds like the paper's `D > 0.10` or `D < -0.10`.
- Risk: sudden equity selloffs make short-vol positions gap immediately; hedge with equity futures if needed.

### 7.3 Volatility carry with two ETNs
- Trade: short `VXX` and buy `VXZ`.
- Run: exploit faster roll decay in short-maturity VIX products versus medium-maturity ones, sizing the hedge ratio by regression.
- Risk: short VXX can suffer brutal mark-to-market pain during volatility spikes even if long-run decay is favorable.

### 7.4 Volatility risk premium
- Trade: sell index volatility, often via short ATM straddles.
- Run: compare implied volatility such as VIX to realized volatility; sell vol when the premium is positive and event risk is modest.
- Risk: works in calm or sideways markets but blows up during abrupt regime changes and crashes.

### 7.5 Volatility skew - long risk reversal
- Trade: buy OTM put and sell OTM call, or the mirror depending on how skew is defined on the desk.
- Run: use when skew looks too flat relative to expected downside demand, especially in assets where left-tail protection is underpriced.
- Risk: this is a directional and skew trade at once; be explicit about which Greeks are intended.

### 7.6 Volatility trading with variance swaps
- Trade: pay or receive realized variance directly instead of assembling option strips manually.
- Run: receive variance when implied variance is too rich versus expected realized variance, or pay variance when anticipating realized-vol expansion.
- Risk: variance is even more convex to jumps than vanilla volatility, so tail events dominate P&L.

## Foreign Exchange (5)

### 8.1 Moving averages with HP filter
- Trade: denoise the FX series with a Hodrick-Prescott style filter, then apply MA crossover rules on the smoothed trend.
- Run: estimate the low-frequency component, compute short and long MAs on it, and trade the crossover rather than raw spot noise.
- Risk: the filter is parameter-sensitive and can revise perceived trend after the fact.

### 8.2 Carry trade
- Trade: fund in low-rate currencies and invest in high-rate currencies, often through forwards.
- Run: sell forwards on currencies at forward premium and buy forwards on currencies at forward discount, or equivalently run an unhedged rate-differential book.
- Risk: FX crashes, especially in risk-off episodes, can wipe out months of carry in days.

### 8.3 Dollar carry trade
- Trade: time the broad USD factor by the average forward discount of foreign currencies versus the dollar.
- Run: go long the dollar against a basket when U.S. carry advantage is rising and short it when the opposite holds.
- Risk: it is a macro factor trade disguised as FX carry, so policy shocks matter.

### 8.4 Momentum and carry combo
- Trade: combine time-series or cross-sectional FX momentum with carry.
- Run: buy currencies with both positive momentum and attractive carry, short those with both negative momentum and unattractive carry.
- Risk: the two signals can align wonderfully until a crowded unwind forces both to reverse together.

### 8.5 FX triangular arbitrage
- Trade: exploit inconsistencies among three exchange rates, such as `EUR/USD`, `USD/JPY`, and `EUR/JPY`.
- Run: compute the implied cross rate continuously and trade the loop when the mispricing exceeds fees and latency risk.
- Risk: this is now largely an ultra-low-latency game; stale quotes and reject risk are the main enemies.

## Commodities (6)

### 9.1 Roll yields
- Trade: favor futures curves with attractive backwardation and avoid or short severe contango.
- Run: rank contracts by roll yield, buy the most positive roll-yield commodities, and short the most negative.
- Risk: storage shocks or inventory changes can reprice the curve before the roll is realized.

### 9.2 Trading based on hedging pressure
- Trade: use CFTC or related positioning data to infer producer versus consumer hedging pressure.
- Run: go long commodities with strong short hedging pressure by commercial sellers if the theory implies risk premia there, and short the opposite.
- Risk: data are lagged and the sign of the premium differs across commodity groups.

### 9.3 Portfolio diversification with commodities
- Trade: hold commodities as a portfolio sleeve to improve multi-asset diversification rather than as a standalone alpha bet.
- Run: allocate by risk parity, equal risk contribution, or inflation-sensitive macro regime weights.
- Risk: in deflationary panics commodities can correlate with other risky assets and fail to diversify.

### 9.4 Value
- Trade: compare spot or futures prices to production-cost or long-run equilibrium proxies.
- Run: buy commodities that look cheap relative to fundamentals and short expensive ones, usually with slow turnover.
- Risk: fair value in commodities can be fuzzy and regime dependent.

### 9.5 Skewness premium
- Trade: exploit the tendency for assets with very negative skewness to earn premia.
- Run: rank commodity futures or option structures by skewness exposure, buy the side that captures the premium and hedge outright delta.
- Risk: the premium is compensation for ugly tails, so drawdowns can be severe.

### 9.6 Trading with pricing models
- Trade: compare observed futures prices to structural models such as cost-of-carry, convenience yield, or inventory-based pricing.
- Run: buy underpriced contracts and short overpriced ones after adjusting for storage, financing, and seasonality.
- Risk: model inputs such as convenience yield are latent and easy to estimate badly.

## Futures (4)

### 10.1 Hedging risk with futures
- Trade: hedge spot or cash-portfolio exposure with futures contracts on the same or a related underlying.
- Run: size the hedge by beta, DV01, duration, or minimum-variance regression; rebalance as the hedge ratio and contract maturity change.
- Risk: basis risk, contract roll, and conversion-factor details can make the hedge imperfect.

### 10.2 Calendar spread
- Trade: long one futures maturity and short another on the same underlying.
- Run: use when expecting relative tightening or loosening between nearby and deferred contracts due to inventory, seasonality, or supply-demand changes.
- Risk: spread relationships can break during delivery squeezes or storage stress.

### 10.3 Contrarian trading (mean-reversion)
- Trade: compute each futures contract's return relative to the equally weighted futures universe.
- Run: buy recent losers and short recent winners, often on a weekly rebalance, optionally filtering by volume and open interest as in the paper.
- Risk: broad commodity trends can overpower short-horizon reversion.

### 10.4 Trend following (momentum)
- Trade: buy contracts with positive trailing returns and short those with negative trailing returns.
- Run: weight by sign of momentum over volatility, or use smoothed momentum scores, then rebalance on a daily, weekly, or monthly schedule.
- Risk: trend following is robust but gives back gains in violent reversals and chop.

## Structured Assets (6)

### 11.2 Carry, equity tranche - index hedging
- Trade: own equity tranches of CDO or credit-index structures and hedge broad spread exposure with the corresponding index.
- Run: harvest high carry while using index CDS to remove part of systematic credit beta.
- Risk: tranche marks gap in crises because correlation and recovery assumptions move together.

### 11.3 Carry, senior/mezzanine - index hedging
- Trade: own senior or mezzanine tranches and hedge with the credit index.
- Run: target spread carry in less equity-like tranches while neutralizing broad market spread moves.
- Risk: senior tranches look safe until correlation shocks make them reprice discontinuously.

### 11.4 Carry - tranche hedging
- Trade: long one tranche and hedge it with another tranche rather than the index.
- Run: isolate relative value between attachment points, such as cheap mezz versus rich senior protection.
- Risk: tranche models are fragile and liquidity can vanish exactly when the relative value matters most.

### 11.5 Carry - CDS hedging
- Trade: own structured credit risk and hedge with single-name or index CDS.
- Run: treat CDS as the flexible hedge leg when tranche or cash hedges are unavailable or expensive.
- Risk: hedge effectiveness depends on correlation, basis, and deliverable-name alignment.

### 11.6 CDOs - curve trades
- Trade: express a view on different maturities of structured-credit spreads.
- Run: buy cheap points on the credit curve and short rich points, usually controlling notional by spread DV01 or expected loss sensitivity.
- Risk: maturity, correlation, and liquidity effects are all entangled, so curve trades are not clean one-factor bets.

### 11.7 Mortgage-backed security (MBS) trading
- Trade: own or short MBS based on prepayment, convexity, and OAS views.
- Run: buy pools or TBAs with favorable OAS and prepayment characteristics; hedge duration with Treasuries or swaps.
- Risk: homeowners' prepayment behavior is path dependent and can overwhelm static models.

## Convertibles (2)

### 12.1 Convertible arbitrage
- Trade: buy a convertible bond and short the issuer's stock against the embedded option delta.
- Run: set hedge ratio as `delta * conversion_ratio`, update it regularly, and collect bond carry while monetizing mispriced optionality.
- Risk: credit deterioration, borrow cost, and gap risk in the stock hedge all matter.

### 12.2 Convertible option-adjusted spread
- Trade: long a convertible with high OAS and short one from the same issuer with low OAS.
- Run: compute the OAS by matching market price with model price under a shifted discount curve, then trade convergence.
- Risk: model OAS is highly assumption-sensitive, so use only relative comparisons within comparable structures.

## Tax Arbitrage (2)

### 13.1 Municipal bond tax arbitrage
- Trade: borrow taxable funding and buy tax-exempt municipal bonds.
- Run: the core equation is `return = muni_yield - funding_rate * (1 - tax_rate)`; only trade where rules actually allow interest deductibility.
- Risk: legal and tax-rule changes can erase the edge overnight.

### 13.2 Cross-border tax arbitrage
- Trade: exploit differences between foreign investors and domestic investors in dividend tax-credit systems.
- Run: avoid unrecoverable dividend tax by selling cum-dividend and rebuying ex-dividend, or by stock lending or swap structures with domestic counterparties.
- Risk: these trades are tax-law trades first and market trades second; documentation and jurisdiction matter more than alpha.

## Miscellaneous Assets (4)

### 14.1 Inflation hedging - inflation swaps
- Trade: buy inflation swaps to receive realized inflation and pay fixed breakeven, or the reverse.
- Run: use zero-coupon swaps for a clean maturity bet or year-on-year swaps for annual inflation exposure.
- Risk: mark-to-market depends on both realized inflation and breakeven repricing.

### 14.2 TIPS-Treasury arbitrage
- Trade: short a nominal Treasury and buy a synthetic replication using TIPS plus inflation swaps and small STRIPS adjustments.
- Run: if the nominal Treasury is overpriced relative to the synthetic fixed-cash-flow package, lock in the basis.
- Risk: funding, swap liquidity, and execution complexity make this harder than the formula suggests.

### 14.3 Weather risk - demand hedging
- Trade: hedge temperature-sensitive revenue with weather derivatives on HDD or CDD indexes.
- Run: for utilities, retailers, agriculture, or transport, map revenue sensitivity to degree days and buy payoff structures that offset weak-demand weather outcomes.
- Risk: basis risk is large because the hedge index rarely matches the exact location and exposure.

### 14.4 Energy - spark spread
- Trade: trade the margin between electricity price and fuel input cost, usually power minus gas adjusted for heat rate.
- Run: go long spark spread when power is cheap versus gas input economics, or short it when margin is too rich; use power and gas futures.
- Risk: regional congestion, plant outages, and weather shocks dominate the theoretical spread.

## Distressed Assets (3)

### 15.1 Buying and holding distressed debt
- Trade: buy distressed bonds or loans below recovery value and wait for restructuring or payout.
- Run: underwrite enterprise value, capital structure rank, covenants, and recovery waterfall before committing.
- Risk: timeline risk is huge; legal process can trap capital for years.

### 15.2 Active distressed investing
- Trade: accumulate distressed claims with the goal of influencing the restructuring.
- Run: build positions across debt classes, engage in the reorganization plan, and choose between trading the claims and converting into control or equity.
- Risk: this requires legal, operational, and negotiation skill, not just market timing.

### 15.3 Distress risk puzzle
- Trade: exploit the empirical pattern that high-distress-risk equities often underperform despite seemingly high risk.
- Run: rank stocks by distress metrics such as default models, then short the riskiest names and buy safer names, with extra attention to financing.
- Risk: distressed squeezes are violent, so the short book must be small, liquid, and tightly risk-managed.

## Real Estate (5)

### 16.2 Mixed-asset diversification with real estate
- Trade: add REITs or property exposure to a broader stock-bond portfolio.
- Run: size real-estate exposure where it improves diversification or inflation sensitivity without overloading rates risk.
- Risk: listed real estate can behave like levered equities during crises.

### 16.3 Intra-asset diversification within real estate
- Trade: diversify across property types, regions, and economic drivers inside the real-estate sleeve.
- Run: spread exposure across office, residential, industrial, retail, and geographies so one local shock does not dominate.
- Risk: diversification can be illusory if financing conditions tighten everywhere at once.

### 16.4 Real estate momentum - regional approach
- Trade: rank regions or REIT segments by past appreciation or rental growth.
- Run: allocate more to regions with positive medium-term trend and cut or short lagging regions where the instrument set allows it.
- Risk: real-estate data are slow and revised, so momentum signals lag more than in liquid markets.

### 16.5 Inflation hedging with real estate
- Trade: own real estate or REITs that can reprice rents with inflation.
- Run: favor assets with short lease duration, pricing power, and replacement-cost support when inflation pressure rises.
- Risk: higher nominal rates can offset the inflation benefit through cap-rate expansion.

### 16.6 Fix-and-flip
- Trade: buy distressed property below market value, renovate, then sell.
- Run: the only way this is agent-operable is as a pipeline model: source discounted inventory, estimate rehab cost, target after-repair value, and require a margin of safety.
- Risk: execution, permitting, financing, and local-market liquidity dominate the spreadsheet.

## Cash (3)

### 17.3 Liquidity management
- Trade: deliberately hold a cash buffer or near-cash sleeve.
- Run: size the cash reserve from expected margin calls, strategy drawdown, and opportunity needs rather than leaving idle cash by accident.
- Risk: too much liquidity creates cash drag; too little forces liquidation at the worst time.

### 17.4 Repurchase agreement (REPO)
- Trade: lend or borrow cash against securities collateral for short periods.
- Run: use repos to finance books, earn secured short-term yield, or source collateralized liquidity from overnight to six-month tenors.
- Risk: haircut changes and collateral-quality shocks are the real risk, not just the repo rate.

### 17.5 Pawnbroking
- Trade: extend short-duration secured loans against collateral at a conservative loan-to-value.
- Run: appraise collateral, lend at a steep discount to resale value, and treat forfeiture workflow as part of expected return.
- Risk: this is operational credit underwriting, not market making; fraud and appraisal error dominate.

## Cryptocurrencies (2)

### 18.2 Artificial neural network (ANN)
- Trade: forecast short-horizon BTC moves from technical features and trade the predicted top or bottom class.
- Run: build inputs from normalized returns, EMAs, exponential moving standard deviations, and RSI on intraday bars; train a classifier with softmax output and buy when the top quantile probability dominates, sell when the bottom one does.
- Risk: crypto regimes change quickly; keep walk-forward retraining strict and penalize overfit architectures.

### 18.3 Sentiment analysis - Naive Bayes Bernoulli
- Trade: map tweet or text features into BTC direction or return-class forecasts.
- Run: build a cleaned vocabulary, convert each message into binary word-presence features, estimate class probabilities with Naive Bayes, then buy or sell when posterior class confidence clears a threshold.
- Risk: spam, bot activity, sarcasm, and sudden vocabulary shifts can destroy a text model fast.

## Global Macro (4)

### 19.2 Fundamental macro momentum
- Trade: rank country or asset exposures by improving macro trends.
- Run: score business cycle, trade, monetary policy, and risk sentiment state variables, then go long the top-ranked assets and short the bottom-ranked ones for roughly three to six months.
- Risk: macro data are revised and lagged, so the system should rely on changes and cross-sectional ranks, not point estimates alone.

### 19.3 Global macro inflation hedge
- Trade: increase commodity exposure when headline inflation materially exceeds core inflation.
- Run: use the paper's allocation rule where commodity weight rises with the `HI - CI` spread, then express the hedge through commodity ETFs or futures.
- Risk: headline-core spread can widen for reasons that do not benefit the chosen commodity basket.

### 19.4 Global fixed-income strategy
- Trade: rank government bonds or country bond ETFs by macro and valuation factors such as GDP, inflation, output gap, real rates, value, momentum, and term spread.
- Run: build a zero-cost cross-sectional portfolio long the top quantile and short the bottom quantile, or blend the factors into a multifactor sovereign book.
- Risk: country bonds embed both rates and FX or sovereign-risk views depending on implementation.

### 19.5 Trading on economic announcements
- Trade: own risky assets mainly on high-impact announcement days and hide in risk-free assets on the other days.
- Run: precompute the FOMC and other macro calendars, buy equity index exposure on announcement days, and rotate into Treasuries or cash otherwise.
- Risk: event premia are crowded and can invert if the market starts pricing announcements earlier.

## Follow-up Additions (4)

### F1 Hidden Markov Model regime-switching allocator
- Trade: switch capital between strategy sleeves such as momentum, mean-reversion, low-vol, or cash based on the inferred market regime.
- Run: fit an HMM or related regime-switching model on returns, volatility, breadth, and macro features; estimate probabilities for states such as trending, choppy, crash, or recovery; then weight each underlying strategy by the current state probabilities instead of using fixed weights.
- Risk: regime models often look smartest in hindsight; they can lag sudden turning points, overfit state labels, or flip too often if the observation set is noisy.

### F2 Alternative-data NLP sentiment trading
- Trade: generate long/short signals from news, earnings calls, filings, and social-media text rather than price data alone.
- Run: collect text streams tied to tickers or sectors, score them with lexicon models or fine-tuned transformer models, aggregate sentiment and surprise measures over a short window, and trade names or baskets when sentiment shifts meaningfully ahead of price.
- Risk: text data is messy, expensive, and easy to misuse; spam, sarcasm, low-quality sources, entity-linking mistakes, and crowded headline reactions can destroy the edge fast.

### F3 Reinforcement-learning portfolio allocation
- Trade: let an RL policy choose portfolio weights, leverage, or trade actions across a basket of assets or strategies.
- Run: define the state as current market features, positions, and risk metrics; define actions as target allocations or trade adjustments; train the policy on a reward that balances return, drawdown, turnover, and costs; then deploy with hard risk constraints and frequent out-of-sample checks.
- Risk: RL can overfit brutally to simulated environments or historical quirks; reward design mistakes create pathological behavior, and live trading can diverge from training because markets react and regimes change.

### F4 Multi-agent debate trading committee
- Trade: route each decision through multiple specialized agents instead of one model, typically a bullish analyst, a bearish risk auditor, and a conservative moderator.
- Run: give all agents the same raw market packet, require independent first-pass views, let them debate in several rounds, and execute only the moderator's final signed recommendation for entry, trim, hold, hedge, or exit.
- Risk: the system can look balanced while hiding structural bias; if all agents are too compliant or share the same model weaknesses, the debate may converge early and produce plausible but weakly stress-tested decisions.
