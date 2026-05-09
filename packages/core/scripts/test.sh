#!/bin/bash
#
# RUDI Core Test Runner
# Runs tests in layers with appropriate flags
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
TEST_DIR="$SCRIPT_DIR/../src/__tests__"
TEST_RUNNER="$SCRIPT_DIR/../../../scripts/run-tests.js"

# Parse arguments
MODE="${1:-all}"
VERBOSE="${VERBOSE:-false}"

# Test reporter
REPORTER="${TEST_REPORTER:-tap}"
if [ "$VERBOSE" = "true" ]; then
  REPORTER="spec"
fi

echo -e "${BLUE}RUDI Core Test Suite${NC}"
echo "Mode: $MODE"
echo "Reporter: $REPORTER"
echo ""

# Helper function to run tests
run_tests() {
  local layer=$1
  local dir=$2
  local skip_flags=$3

  echo -e "${YELLOW}▶ Running $layer tests...${NC}"

  if [ -z "$skip_flags" ]; then
    node "$TEST_RUNNER" --test-reporter="$REPORTER" "$dir"
  else
    env $skip_flags node "$TEST_RUNNER" --test-reporter="$REPORTER" "$dir"
  fi

  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ $layer tests passed${NC}\n"
  else
    echo -e "${RED}✗ $layer tests failed${NC}\n"
    exit 1
  fi
}

# Run tests based on mode
case "$MODE" in
  unit)
    run_tests "Unit" "$TEST_DIR/unit/"
    ;;

  integration)
    run_tests "Integration" "$TEST_DIR/integration/" "SKIP_NPM_TESTS=true"
    ;;

  integration-full)
    echo -e "${YELLOW}Note: Running full integration tests including slow npm installs${NC}"
    run_tests "Integration (Full)" "$TEST_DIR/integration/"
    ;;

  e2e)
    echo -e "${YELLOW}Prerequisites: Ollama installed and running${NC}"
    echo -e "${YELLOW}  1. Install: https://ollama.com/download${NC}"
    echo -e "${YELLOW}  2. Start: ollama serve${NC}"
    echo -e "${YELLOW}  3. Pull model: ollama pull nomic-embed-text${NC}"
    echo ""
    run_tests "E2E" "$TEST_DIR/e2e/"
    ;;

  fast)
    echo -e "${BLUE}Fast mode: Unit + Integration (no npm, no E2E)${NC}\n"
    run_tests "Unit" "$TEST_DIR/unit/"
    run_tests "Integration" "$TEST_DIR/integration/" "SKIP_NPM_TESTS=true SKIP_E2E=true"
    ;;

  ci)
    echo -e "${BLUE}CI mode: Unit + Integration (fast)${NC}\n"
    run_tests "Unit" "$TEST_DIR/unit/"
    run_tests "Integration" "$TEST_DIR/integration/" "SKIP_NPM_TESTS=true SKIP_E2E=true"
    ;;

  all)
    echo -e "${BLUE}Running all test layers${NC}\n"
    run_tests "Unit" "$TEST_DIR/unit/"
    run_tests "Integration" "$TEST_DIR/integration/" "SKIP_NPM_TESTS=true"
    run_tests "E2E" "$TEST_DIR/e2e/" "SKIP_E2E=true"
    echo -e "${YELLOW}Note: E2E tests skipped. Run './scripts/test.sh e2e' to run with Ollama${NC}"
    ;;

  *)
    echo -e "${RED}Unknown mode: $MODE${NC}"
    echo ""
    echo "Usage: $0 [mode]"
    echo ""
    echo "Modes:"
    echo "  unit              - Fast unit tests only (~100ms)"
    echo "  integration       - Integration tests, no npm (~5s)"
    echo "  integration-full  - Integration tests with npm (~30s)"
    echo "  e2e               - E2E tests (requires Ollama)"
    echo "  fast              - Unit + Integration (no npm/E2E) - DEFAULT for CI"
    echo "  ci                - Same as 'fast'"
    echo "  all               - All tests except E2E (E2E requires manual flag)"
    echo ""
    echo "Environment variables:"
    echo "  VERBOSE=true      - Use 'spec' reporter for detailed output"
    echo "  SKIP_NPM_TESTS=true"
    echo "  SKIP_E2E=true"
    echo ""
    echo "Examples:"
    echo "  $0 unit           # Fast unit tests"
    echo "  $0 fast           # Quick CI run"
    echo "  VERBOSE=true $0 integration"
    echo "  $0 e2e            # Full E2E with Ollama"
    exit 1
    ;;
esac

echo -e "${GREEN}✓ All tests passed!${NC}"
