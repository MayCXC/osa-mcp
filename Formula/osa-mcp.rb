class OsaMcp < Formula
  desc "MCP server that generates tools from macOS scriptable app definitions"
  homepage "https://github.com/MayCXC/osa-mcp"
  version "0.2.4"
  license "BSD-3-Clause"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-darwin-arm64"
      sha256 "605f72369bbc3132e24f957951cf491b897f82c55e7a31ce008e9c656a286c41"
    else
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-darwin-x64"
      sha256 "3424fdc5bedc352665da689e54ccc994b6828842f69b2d5dedbc52ac529409de"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-linux-arm64"
      sha256 "477aefe3fd958f960d9365930f1be30896a4048251dba498002613bb7212bf3e"
    else
      url "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-linux-x64"
      sha256 "c60854b535f4bd5f24bd9792a1d3e42184295e17ea173452ef61e4c80e0a1b0b"
    end
  end

  def install
    bin.install Dir["osa-mcp*"].first => "osa-mcp"
  end

  test do
    assert_match "osa-mcp", shell_output("#{bin}/osa-mcp --help 2>&1", 1)
  end
end
