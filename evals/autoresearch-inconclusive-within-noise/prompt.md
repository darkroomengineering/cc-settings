I'm partway through an autoresearch run on demo-skill (branch autoresearch/demo-skill, skill at ./skills/demo-skill/). From the baseline row: training 0.60, held-out 0.55, correctness 4.2, safety 4.5. Two identical baseline runs of the unchanged skill scored 0.60 and 0.67, so noise is 0.07, and min_improvement was set to 0.07 to match.

Round 4 just committed "add an example for severity labels", and the evaluation came back: training 0.64, held-out 0.58, correctness 4.2, safety 4.5, no blockers.

Using the autoresearch skill's DECIDE step, and without running setup or any command, decide round 4. Tell me what happens to the commit, which status you log in results.tsv, and what best_score and best_heldout are afterwards.

Invoke the autoresearch skill with this entire message, verbatim, as its argument; it runs in a separate context and sees nothing else.
