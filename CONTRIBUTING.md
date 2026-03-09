# Contributing to Minecraft Survival MCP Server

Thank you for your interest in contributing! We welcome all contributions to improve this Minecraft Survival MCP server.

## Getting Started

1. **Fork the repository** on GitHub.
2. **Clone your fork** locally.
3. **Install dependencies**:
   ```bash
   npm install
   ```

## Development Workflow

- **Run in development mode**:
  ```bash
   npm run dev
   ```
- **Build the project**:
  ```bash
   npm run build
   ```
- **Run tests**:
  ```bash
   npm run test
   ```

## Pull Request Process

1. Ensure your code follows the existing style.
2. Update the README.md if you are adding or changing functionality.
3. Make sure all tests pass (`npm run test`).
4. Submit a Pull Request with a clear description of your changes.

## Branch Naming Convention

To maintain a clear and organized development history, we require branch names to follow a prefix convention similar to our commit messages:

- `feat/description-of-feature`
- `fix/description-of-bugfix`
- `chore/task-description`
- `docs/documentation-update`
- `refactor/code-improvement`

Example: `feat/add-thermal-vision-tool`

## Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/) for our commit messages. This allows us to automatically generate changelogs and manage semantic versioning.

Your commit messages should follow this pattern:
`<type>[optional scope]: <description>`

**Common types include:**
- `feat`: A new feature (triggers a MINOR release)
- `fix`: A bug fix (triggers a PATCH release)
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (white-space, formatting, etc)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools and libraries

**Example:**
`feat(vision): add tool for thermal imaging`

## Code of Conduct

Please be respectful and professional in all interactions.
