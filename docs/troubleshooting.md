# Troubleshooting

## No screenshots

- Rebuild the native addon.
- Update GPU drivers.
- Run the capture test script:
  - `npx ts-node test/test-window-capture.ts`

## Actions misaligned

- Confirm `space` and `normalized` flags in backend responses.
- Verify capture resolution vs model space.
- Inspect `desktop/src/agent/coord-mapper.ts`.

## Agent stuck

- Confirm backend returns `finish_task`.
- Check TestCase status transitions in the backend.
- Inspect vision analyze logs and worker output.
