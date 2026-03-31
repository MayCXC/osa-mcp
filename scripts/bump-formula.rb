require "digest"

version = ARGV[0]
release_dir = ARGV[1]
abort "Usage: ruby scripts/bump-formula.rb <version> [release-dir]" unless version

version = version.delete_prefix("v")
formula_path = File.join(__dir__, "..", "Formula", "osa-mcp.rb")
formula = File.read(formula_path)

platforms = %w[darwin-arm64 darwin-x64 linux-arm64 linux-x64]

platforms.each do |platform|
  if release_dir
    path = File.join(release_dir, "osa-mcp-#{platform}")
    abort "Missing binary: #{path}" unless File.exist?(path)
    sha256 = Digest::SHA256.file(path).hexdigest
  else
    require "net/http"
    url = "https://github.com/MayCXC/osa-mcp/releases/download/v#{version}/osa-mcp-#{platform}"
    puts "Fetching #{url}..."
    uri = URI(url)
    response = Net::HTTP.get_response(uri)
    response = Net::HTTP.get_response(URI(response["location"])) while response.is_a?(Net::HTTPRedirection)
    abort "Failed to fetch #{platform}: #{response.code}" unless response.is_a?(Net::HTTPSuccess)
    sha256 = Digest::SHA256.hexdigest(response.body)
  end

  puts "  #{platform}: #{sha256}"
  formula.sub!(/(osa-mcp-#{Regexp.escape(platform)}.*?\n\s+sha256 )"[^"]*"/) do
    "#{$1}\"#{sha256}\""
  end
end

formula.sub!(/version "[^"]*"/, "version \"#{version}\"")
File.write(formula_path, formula)
puts "Updated #{formula_path}"
