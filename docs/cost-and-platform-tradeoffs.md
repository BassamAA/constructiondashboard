# Cost And Platform Tradeoffs

## Current platform split

- Fly: production
- AWS: disposable staging

## Why not move production to AWS now

The AWS staging stack is stronger from a DevOps portfolio perspective, but it is not automatically the right production choice for this application today.

Reasons:

- the app is already working in production on Fly
- AWS introduces more moving parts
- AWS has a higher fixed monthly cost for this architecture
- migration would create operational risk without a clear business win

## Main AWS cost drivers in this project

- RDS instance
- NAT gateway
- App Runner
- CloudWatch dashboard and alarms

The NAT gateway is a major fixed cost even with low traffic.

## Why disposable staging is the right compromise

- keeps AWS costs temporary instead of permanent
- preserves a strong DevOps showcase environment
- allows repeated bring-up and tear-down for demos and learning
- avoids committing live users to a more expensive platform prematurely

## When AWS production might become justified

- the current Fly setup no longer meets reliability needs
- the team needs deeper AWS-native integration
- compliance or security requirements favor AWS controls
- predictable scaling or networking requirements exceed current platform fit

## Current recommendation

- keep Fly as production
- use AWS for staging and DevOps demonstration
- only revisit migration after a cost, reliability, and operational review
