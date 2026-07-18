# e2ebuddy CLI

The npm package remains private until the external release evaluations are approved.

```bash
pnpm -F e2ebuddy cli executor-demo https://example.com
```

```bash
AI_PROVIDER=openai-compatible \
AI_API_KEY="..." \
AI_BASE_URL="https://token-plan-cn.xiaomimimo.com/v1" \
AI_AGENT_MODEL="mimo-v2.5-pro" \
AI_VISION_MODEL="mimo-v2.5" \
AI_THINKING="disabled" \
pnpm -F e2ebuddy cli explore https://example.com --brief "Product brief"
```

```bash
AI_PROVIDER=openai-compatible \
AI_API_KEY="..." \
AI_BASE_URL="https://token-plan-cn.xiaomimimo.com/v1" \
AI_AGENT_MODEL="mimo-v2.5-pro" \
AI_VISION_MODEL="mimo-v2.5" \
AI_THINKING="disabled" \
AI_REPORT_MODEL="mimo-v2.5" \
pnpm -F e2ebuddy cli test https://example.com --brief "Product brief"
```

See the repository-level README and `E2EBUDDY_SPEC.md` for the complete roadmap and security model.
