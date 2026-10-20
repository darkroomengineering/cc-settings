Three times this week I've had to stop an agent in this repo that ran the whole `pytest` suite after a one-file change. It takes about 20 minutes. The README already says to use `make test-fast` for local checks, and they still do it. Harvest this into something durable so it stops happening.

Invoke the harvest skill with this entire message, verbatim, as its argument; it runs in a separate context and sees nothing else.
