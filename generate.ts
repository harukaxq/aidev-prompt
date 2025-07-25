import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "fs";
import { join } from "path";

// テンプレートディレクトリのパス
const templateDir = join(__dirname, "template");

// 出力先ディレクトリ
const generatedDir = join(__dirname, "generated_prompt");
if (!existsSync(generatedDir)) {
  mkdirSync(generatedDir, { recursive: true });
}

// プロンプト入力ディレクトリ
const promptDir = join(__dirname, "prompt");
if (!existsSync(promptDir)) {
  console.error("promptディレクトリが存在しません。");
  process.exit(1);
}

// テンプレートファイル一覧を取得
const templateFiles = readdirSync(templateDir).filter(f => statSync(join(templateDir, f)).isFile());

// 置換用: {{template/ARCHITECTURE.md}} などのパターンにマッチする正規表現
const templatePattern = /\{\{\{\{([^\}]+)\}\}\}\}/g;

// <architecture> ... </architecture> で囲まれた部分を検出する正規表現
const architectureBlockPattern = /<architecture>[\s\S]*?<\/architecture>/g;

const promptFiles = readdirSync(promptDir);

for (const file of promptFiles) {
  const filePath = join(promptDir, file);
  if (statSync(filePath).isFile()) {
    let content = readFileSync(filePath, "utf-8");

    // すべての {{template/xxx}} シンタックスをファイル内容で置換
    const replacedContent = content.replace(templatePattern, (match, relPath) => {
      // relPath例: "template/ARCHITECTURE.md"
      let templatePath: string;
      if (relPath.startsWith("template/")) {
        templatePath = join(__dirname, relPath);
      } else {
        templatePath = join(templateDir, relPath);
      }
      if (existsSync(templatePath) && statSync(templatePath).isFile()) {
        return readFileSync(templatePath, "utf-8");
      } else {
        console.warn(`テンプレートファイルが見つかりません: ${templatePath}`);
        return match; // 置換せずそのまま
      }
    });

    // 通常の置換後ファイルを書き出し
    writeFileSync(join(generatedDir, file), replacedContent, "utf-8");

    // <architecture> ... </architecture> を空文字に置換したバージョンを作成
    const withoutArchitecture = content.replace(architectureBlockPattern, "");
    const replacedWithoutArchitecture = withoutArchitecture.replace(templatePattern, (match, relPath) => {
      let templatePath: string;
      if (relPath.startsWith("template/")) {
        templatePath = join(__dirname, relPath);
      } else {
        templatePath = join(templateDir, relPath);
      }
      if (existsSync(templatePath) && statSync(templatePath).isFile()) {
        return readFileSync(templatePath, "utf-8");
      } else {
        console.warn(`テンプレートファイルが見つかりません: ${templatePath}`);
        return match;
      }
    });

    // ファイル名の拡張子前に _WITHOUT_ARCHITECTURE を付与
    const dotIdx = file.lastIndexOf(".");
    const fileNameWithoutExt = dotIdx !== -1 ? file.slice(0, dotIdx) : file;
    const ext = dotIdx !== -1 ? file.slice(dotIdx) : "";
    const newFileName = `${fileNameWithoutExt}_WITHOUT_ARCHITECTURE${ext}`;
    writeFileSync(join(generatedDir, newFileName), replacedWithoutArchitecture, "utf-8");
  }
}