/**
 * FrameworkDetector - Auto-detect project framework and configure appropriate error patterns
 *
 * Problem: Manual pattern setup required for error detection
 * Solution: Intelligent framework detection with pre-configured patterns
 */

import { readFile, access } from 'fs/promises';
import { join } from 'path';
import type { ErrorPattern } from '../types/index.js';
import type { Logger } from './logger.js';

export interface FrameworkInfo {
  name: string;
  version?: string;
  confidence: number; // 0-1 confidence score
  indicators: string[]; // What caused the detection
  workingDirectory?: string;
}

export interface FrameworkConfig {
  errorPatterns: ErrorPattern[];
  buildCommands: string[];
  testCommands: string[];
  devCommands: string[];
  fileExtensions: string[];
  keywords: string[];
}

export class FrameworkDetector {
  private frameworkConfigs: Map<string, FrameworkConfig> = new Map();
  private detectionCache: Map<string, FrameworkInfo[]> = new Map();

  constructor(private logger: Logger) {
    this.initializeFrameworkConfigs();
  }

  /**
   * Detect frameworks in a directory based on files, commands, and patterns
   */
  async detectFrameworks(
    workingDirectory: string = process.cwd(),
    currentCommand?: string
  ): Promise<FrameworkInfo[]> {
    // Check cache first
    const cacheKey = `${workingDirectory}:${currentCommand || ''}`;
    if (this.detectionCache.has(cacheKey)) {
      return this.detectionCache.get(cacheKey)!;
    }

    const detectedFrameworks: FrameworkInfo[] = [];

    // File-based detection
    const fileBasedFrameworks = await this.detectFromFiles(workingDirectory);
    detectedFrameworks.push(...fileBasedFrameworks);

    // Command-based detection
    if (currentCommand) {
      const commandBasedFrameworks = this.detectFromCommand(currentCommand);
      detectedFrameworks.push(...commandBasedFrameworks);
    }

    // Merge and deduplicate
    const mergedFrameworks = this.mergeFrameworkDetections(detectedFrameworks);

    // Sort by confidence
    mergedFrameworks.sort((a, b) => b.confidence - a.confidence);

    // Cache result
    this.detectionCache.set(cacheKey, mergedFrameworks);

    this.logger.debug(`Detected frameworks in ${workingDirectory}:`,
      mergedFrameworks.map(f => `${f.name} (${(f.confidence * 100).toFixed(0)}%)`).join(', ')
    );

    return mergedFrameworks;
  }

  /**
   * Get error patterns for detected frameworks
   */
  getErrorPatternsForFrameworks(frameworks: FrameworkInfo[]): ErrorPattern[] {
    const patterns: ErrorPattern[] = [];
    const addedPatterns = new Set<string>();

    for (const framework of frameworks) {
      const config = this.frameworkConfigs.get(framework.name);
      if (config) {
        for (const pattern of config.errorPatterns) {
          const key = `${pattern.name}-${pattern.language}`;
          if (!addedPatterns.has(key)) {
            patterns.push({
              ...pattern,
              // Add framework context to pattern name
              name: `${pattern.name}_${framework.name}`,
            });
            addedPatterns.add(key);
          }
        }
      }
    }

    return patterns;
  }

  /**
   * Get recommended commands for frameworks
   */
  getRecommendedCommands(frameworks: FrameworkInfo[]): {
    build: string[];
    test: string[];
    dev: string[];
  } {
    const build: string[] = [];
    const test: string[] = [];
    const dev: string[] = [];

    for (const framework of frameworks) {
      const config = this.frameworkConfigs.get(framework.name);
      if (config) {
        build.push(...config.buildCommands);
        test.push(...config.testCommands);
        dev.push(...config.devCommands);
      }
    }

    return {
      build: Array.from(new Set(build)),
      test: Array.from(new Set(test)),
      dev: Array.from(new Set(dev)),
    };
  }

  /**
   * Clear detection cache
   */
  clearCache(): void {
    this.detectionCache.clear();
  }

  /**
   * Detect frameworks based on files in directory
   */
  private async detectFromFiles(workingDirectory: string): Promise<FrameworkInfo[]> {
    const frameworks: FrameworkInfo[] = [];

    try {
      // Check for specific files that indicate frameworks
      const fileChecks = [
        { file: 'package.json', framework: 'node', confidence: 0.9 },
        { file: 'tsconfig.json', framework: 'typescript', confidence: 0.8 },
        { file: 'Cargo.toml', framework: 'rust', confidence: 0.9 },
        { file: 'go.mod', framework: 'go', confidence: 0.9 },
        { file: 'requirements.txt', framework: 'python', confidence: 0.7 },
        { file: 'pyproject.toml', framework: 'python', confidence: 0.8 },
        { file: 'setup.py', framework: 'python', confidence: 0.7 },
        { file: 'pom.xml', framework: 'java', confidence: 0.9 },
        { file: 'build.gradle', framework: 'java', confidence: 0.8 },
        { file: 'CMakeLists.txt', framework: 'cmake', confidence: 0.8 },
        { file: 'Makefile', framework: 'make', confidence: 0.6 },
        { file: 'docker-compose.yml', framework: 'docker', confidence: 0.7 },
        { file: 'Dockerfile', framework: 'docker', confidence: 0.7 },
      ];

      for (const { file, framework, confidence } of fileChecks) {
        try {
          const filePath = join(workingDirectory, file);
          await access(filePath);
          frameworks.push({
            name: framework,
            confidence,
            indicators: [`Found ${file}`],
            workingDirectory,
          });
        } catch {
          // File doesn't exist, continue
        }
      }

      // Enhanced Node.js detection from package.json
      try {
        const packageJsonPath = join(workingDirectory, 'package.json');
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));

        const nodeFramework = frameworks.find(f => f.name === 'node');
        if (nodeFramework) {
          const indicators = [...nodeFramework.indicators];
          let confidence = nodeFramework.confidence;

          // Detect specific Node.js frameworks
          const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

          if (dependencies.react) {
            frameworks.push({
              name: 'react',
              version: dependencies.react,
              confidence: 0.9,
              indicators: ['React dependency in package.json'],
              workingDirectory,
            });
          }

          if (dependencies.vue || dependencies['@vue/core']) {
            frameworks.push({
              name: 'vue',
              confidence: 0.9,
              indicators: ['Vue dependency in package.json'],
              workingDirectory,
            });
          }

          if (dependencies.angular || dependencies['@angular/core']) {
            frameworks.push({
              name: 'angular',
              confidence: 0.9,
              indicators: ['Angular dependency in package.json'],
              workingDirectory,
            });
          }

          if (dependencies.next) {
            frameworks.push({
              name: 'nextjs',
              confidence: 0.9,
              indicators: ['Next.js dependency in package.json'],
              workingDirectory,
            });
          }

          if (dependencies.express) {
            frameworks.push({
              name: 'express',
              confidence: 0.8,
              indicators: ['Express dependency in package.json'],
              workingDirectory,
            });
          }

          // Update Node.js confidence based on scripts
          if (packageJson.scripts) {
            if (packageJson.scripts.build) indicators.push('Has build script');
            if (packageJson.scripts.test) indicators.push('Has test script');
            if (packageJson.scripts.dev || packageJson.scripts.start) {
              indicators.push('Has dev/start script');
            }
            confidence = Math.min(1.0, confidence + 0.1);
          }

          nodeFramework.indicators = indicators;
          nodeFramework.confidence = confidence;
          nodeFramework.version = packageJson.engines?.node;
        }
      } catch {
        // package.json not readable, continue
      }

    } catch (error) {
      this.logger.error(`Error detecting frameworks from files in ${workingDirectory}:`, error);
    }

    return frameworks;
  }

  /**
   * Detect frameworks from current command
   */
  private detectFromCommand(command: string): FrameworkInfo[] {
    const frameworks: FrameworkInfo[] = [];
    const lowerCommand = command.toLowerCase();

    const commandPatterns = [
      { pattern: /npm|yarn|pnpm/, framework: 'node', confidence: 0.8 },
      { pattern: /node(?:\s|$)/, framework: 'node', confidence: 0.7 },
      { pattern: /tsc|tsx|typescript/, framework: 'typescript', confidence: 0.9 },
      { pattern: /react|jsx/, framework: 'react', confidence: 0.8 },
      { pattern: /vue/, framework: 'vue', confidence: 0.8 },
      { pattern: /angular|ng\s/, framework: 'angular', confidence: 0.8 },
      { pattern: /next/, framework: 'nextjs', confidence: 0.8 },
      { pattern: /cargo|rustc/, framework: 'rust', confidence: 0.9 },
      { pattern: /go\s(run|build|test)/, framework: 'go', confidence: 0.9 },
      { pattern: /python3?|pip/, framework: 'python', confidence: 0.8 },
      { pattern: /java|javac|mvn|gradle/, framework: 'java', confidence: 0.8 },
      { pattern: /docker/, framework: 'docker', confidence: 0.7 },
      { pattern: /make/, framework: 'make', confidence: 0.6 },
      { pattern: /cmake/, framework: 'cmake', confidence: 0.8 },
      { pattern: /jest|vitest|mocha/, framework: 'testing', confidence: 0.7 },
      { pattern: /webpack|vite|rollup/, framework: 'bundler', confidence: 0.7 },
    ];

    for (const { pattern, framework, confidence } of commandPatterns) {
      if (pattern.test(lowerCommand)) {
        frameworks.push({
          name: framework,
          confidence,
          indicators: [`Running command: ${command}`],
        });
      }
    }

    return frameworks;
  }

  /**
   * Merge duplicate framework detections and combine confidence scores
   */
  private mergeFrameworkDetections(frameworks: FrameworkInfo[]): FrameworkInfo[] {
    const merged = new Map<string, FrameworkInfo>();

    for (const framework of frameworks) {
      const existing = merged.get(framework.name);
      if (existing) {
        // Combine confidence scores (max of both, with bonus for multiple detections)
        const combinedConfidence = Math.min(1.0,
          Math.max(existing.confidence, framework.confidence) + 0.1
        );

        existing.confidence = combinedConfidence;
        existing.indicators = [...existing.indicators, ...framework.indicators];

        // Keep version from highest confidence detection
        if (framework.confidence > existing.confidence && framework.version) {
          existing.version = framework.version;
        }
      } else {
        merged.set(framework.name, { ...framework });
      }
    }

    return Array.from(merged.values());
  }

  /**
   * Initialize predefined framework configurations
   */
  private initializeFrameworkConfigs(): void {
    // Node.js/JavaScript
    this.frameworkConfigs.set('node', {
      errorPatterns: [
        {
          name: 'node_error',
          regex: /^Error: (.+)$/,
          type: 'error',
          language: 'javascript',
          captureGroups: { message: 1 },
        },
        {
          name: 'node_module_not_found',
          regex: /Error: Cannot find module '(.+)'/,
          type: 'error',
          language: 'javascript',
          captureGroups: { message: 1 },
        },
      ],
      buildCommands: ['npm run build', 'yarn build', 'pnpm build'],
      testCommands: ['npm test', 'yarn test', 'pnpm test'],
      devCommands: ['npm run dev', 'yarn dev', 'pnpm dev', 'node server.js'],
      fileExtensions: ['.js', '.mjs', '.cjs'],
      keywords: ['npm', 'node', 'javascript'],
    });

    // TypeScript
    this.frameworkConfigs.set('typescript', {
      errorPatterns: [
        {
          name: 'typescript_error',
          regex: /^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s*TS(\d+):\s*(.+)$/,
          type: 'error',
          language: 'typescript',
          captureGroups: {
            file: 1,
            line: 2,
            column: 3,
            message: 6,
          },
        },
      ],
      buildCommands: ['tsc', 'npm run build', 'yarn build'],
      testCommands: ['npm test', 'yarn test'],
      devCommands: ['tsc --watch', 'npm run dev', 'yarn dev'],
      fileExtensions: ['.ts', '.tsx'],
      keywords: ['typescript', 'tsc'],
    });

    // React
    this.frameworkConfigs.set('react', {
      errorPatterns: [
        {
          name: 'react_error',
          regex: /Error: (.+)/,
          type: 'error',
          language: 'javascript',
          captureGroups: { message: 1 },
        },
        {
          name: 'jsx_error',
          regex: /SyntaxError: (.+)/,
          type: 'error',
          language: 'javascript',
          captureGroups: { message: 1 },
        },
      ],
      buildCommands: ['npm run build', 'yarn build'],
      testCommands: ['npm test', 'yarn test'],
      devCommands: ['npm start', 'yarn start', 'npm run dev', 'yarn dev'],
      fileExtensions: ['.jsx', '.tsx'],
      keywords: ['react', 'jsx'],
    });

    // Python
    this.frameworkConfigs.set('python', {
      errorPatterns: [
        {
          name: 'python_error',
          regex: /^Traceback \(most recent call last\):/,
          type: 'error',
          language: 'python',
          captureGroups: { message: 0 },
        },
        {
          name: 'python_syntax_error',
          regex: /File "(.+)", line (\d+).*\n\s*(.+)$/,
          type: 'error',
          language: 'python',
          captureGroups: {
            file: 1,
            line: 2,
            message: 3,
          },
        },
      ],
      buildCommands: ['python -m py_compile', 'python setup.py build'],
      testCommands: ['pytest', 'python -m pytest', 'python -m unittest'],
      devCommands: ['python main.py', 'python app.py', 'flask run', 'django runserver'],
      fileExtensions: ['.py'],
      keywords: ['python', 'pip', 'pytest'],
    });

    // Rust
    this.frameworkConfigs.set('rust', {
      errorPatterns: [
        {
          name: 'rust_error',
          regex: /error.*?:\s*(.+)\n.*?--> (.+?):(\d+):(\d+)/s,
          type: 'error',
          language: 'rust',
          captureGroups: {
            file: 2,
            line: 3,
            column: 4,
            message: 1,
          },
        },
      ],
      buildCommands: ['cargo build', 'cargo check'],
      testCommands: ['cargo test'],
      devCommands: ['cargo run', 'cargo watch -x run'],
      fileExtensions: ['.rs'],
      keywords: ['cargo', 'rust'],
    });

    // Go
    this.frameworkConfigs.set('go', {
      errorPatterns: [
        {
          name: 'go_error',
          regex: /^(.+?):(\d+):(\d+):\s*(.+)$/,
          type: 'error',
          language: 'go',
          captureGroups: {
            file: 1,
            line: 2,
            column: 3,
            message: 4,
          },
        },
      ],
      buildCommands: ['go build', 'go install'],
      testCommands: ['go test', 'go test ./...'],
      devCommands: ['go run main.go', 'go run .'],
      fileExtensions: ['.go'],
      keywords: ['go'],
    });
  }
}