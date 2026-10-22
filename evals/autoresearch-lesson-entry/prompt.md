I'm stopping my autoresearch run on demo-skill now (model claude-sonnet-5-5, noise floor 0.05). Here is results.tsv:

```
round	commit	score	heldout	correctness	safety	samples	status	description
0	baseline	0.55	0.50	4.1	4.6	3	baseline	initial measurement, noise 0.05, bar +0.05
1	a1b2c3d	0.58	0.52	4.1	4.6	3	inconclusive	add the example "Plan the Q3 offsite for 40 people" with owners filled in
2	b2c3d4e	0.66	0.62	4.2	4.6	3	kept	require every next step to start with the owner's role, test 1 item 3 split Y/N
3	c3d4e5f	0.71	0.60	4.2	4.5	3	overfit	add a deadline column template
4	d4e5f6a	0.64	0.61	4.2	4.6	3	reverted	restructure: move format rules above the summary rule and shorten both
```

Using the autoresearch skill, and without running any command, show me exactly what you would append to the lessons file for this run, and say which rows it rests on.

Invoke the autoresearch skill with this entire message, verbatim, as its argument; it runs in a separate context and sees nothing else.
