# Backend Domain Guidance

When reviewing backend changes, pay special attention to:
- API contract changes (request/response shapes, status codes, headers)
- Database migration safety (backward compatibility, data loss risk)
- Authentication and authorization boundary changes
- Error handling and retry behavior
- Dependency version changes and supply-chain risk
- Service-to-service communication patterns
