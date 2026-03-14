#!/bin/bash
pnpm check
DATABASE_URL=postgres://dummy:dummy@localhost:5432/dummy pnpm run test
