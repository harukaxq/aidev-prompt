// このスクリプトはgenerated_promptディレクトリ内の全ファイルを
// impl.md形式または_wo.md形式にリネームし、~/.claude/commands/にコピーします。
// "without_architecture"（大文字・小文字問わず）を含むファイルは"_wo.md"に変換します（小文字化）。

const fs = require("fs");
const path = require("path");
const os = require("os");

const srcDir = path.join(process.cwd(), "generated_prompt");
const destDir = path.join(os.homedir(), ".claude", "commands");

// ディレクトリがなければ作成
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

// generated_prompt配下の全ファイルを取得
const files: string[] = fs.readdirSync(srcDir);

files.forEach((file: string) => {
  const srcPath = path.join(srcDir, file);

  // ディレクトリはスキップ
  if (fs.statSync(srcPath).isDirectory()) return;

  // ファイル名変換ロジック（小文字化＋without_architectureを_wo.mdに変換）
  let base = path.parse(file).name.toLowerCase();
  let newName: string;
  if (base.includes("without_architecture")) {
    base = base.replace(/without_architecture/gi, "");
    newName = `${base}_wo.md`;
  } else {
    newName = `${base}.md`;
  }
  // 先頭や末尾のアンダースコアを整理
  newName = newName.replace(/^_+|_+$/g, "").replace(/__+/g, "_");

  const destPath = path.join(destDir, newName);

  // コピー
  fs.copyFileSync(srcPath, destPath);
  console.log(`コピー: ${srcPath} → ${destPath}`);
});

console.log("全ファイルのコピーとリネームが完了しました。");
