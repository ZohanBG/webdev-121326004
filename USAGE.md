# Usage

One row per agent session. In Gemini CLI, type `/stats` before you quit and copy the input and output tokens. Copilot shows credits instead of tokens: write those in the credits column. The free tier charges nothing, so record what the session **would cost at the provider's published list price**, and note once below the table which price list you used. Leave the cost empty for rows that only show credits.

| Date | Tool | Input tokens | Output tokens | Credits (if no tokens) | List-price cost |
|---|---|---|---|---|---|
| 2026-10-14 | Claude Code (Opus 5.5), Exercise 1 | 4 702 093 | 37 671 | | $2.36 |
| 2026-10-14 | GitHub Copilot (Auto, gpt-5.6-luna), description experiment | | | 0.7 | |
| 2026-11-11 | Claude Code (Opus 5.5, plus one Haiku 5.5 web-fetch subagent), Exercise 2 spec (so far) | 4 799 825 | 49 652 | | $3.10 |

Price list: Anthropic API list prices per 1M tokens. Claude Opus 5.5: $4 input, $20 output, $0.20 cache read, $8 cache write (1-hour). Claude Haiku 5.5: $0.10 input, $0.50 output. I use Claude Code on a Claude Max subscription, so these sessions cost nothing extra; the cost column is what the same tokens would cost on the API. Claude Code has no per-session token counter on a subscription, so the token numbers are summed from the session transcript (`usage` of every model reply). Input includes cached input: almost all of it is cache reads (4.6M of 4.7M in Exercise 1), because every reply re-reads the conversation so far. The Copilot credits are from the two runs that showed a count (0.6 + 0.1).
