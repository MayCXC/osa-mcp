class OsaMcp < Formula
  desc "MCP server that generates tools from macOS scriptable app definitions"
  homepage "https://github.com/MayCXC/osa-mcp"
  version "0.2.8"
  license "BSD-3-Clause"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-darwin-arm64"
      sha256 "f158db6f4381de42e7fd57b4fe271840443965c9426cdd9c60390c21c8b4834a"
    else
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-darwin-x64"
      sha256 "53e76391817b16ba654aa56e0920af20cd15ab2d48ac707858ea12d59a5cadbc"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-linux-arm64"
      sha256 "0cc717435a37a9b168f6f1323f4ea643225a21cfec9111020f108ab21f145897"
    else
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-linux-x64"
      sha256 "6fd06b887904306a510ef02f58323c21fa3f83bc0d211ff633406c2d0cf439cb"
    end
  end

  def install
    bin.install Dir["osa-mcp*"].first => "osa-mcp"
  end

  test do
    assert_match "osa-mcp", shell_output("#{bin}/osa-mcp --help 2>&1", 1)
  end
end
