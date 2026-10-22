# frozen_string_literal: true

require_relative "lib/postseed/version"

Gem::Specification.new do |s|
  s.name        = "postseed"
  s.version     = Postseed::VERSION
  s.summary     = "Realistic, relationship-correct seed data for PostgreSQL"
  s.description = "Postseed generates realistic seed data for PostgreSQL that never breaks a foreign key, a unique " \
                  "constraint or an enum, and is deterministic: the same schema, seed and version give identical " \
                  "output. It runs locally with a web Studio and a CLI. This gem bundles the engine and runs it with " \
                  "Node.js 20 or newer."
  s.authors     = ["Sagar Pinninti"]
  s.license     = "MIT"
  s.homepage    = "https://github.com/isagarpinninti/postseed"
  s.required_ruby_version = ">= 2.6"
  s.files       = Dir["lib/**/*", "exe/*", "README.md", "LICENSE"]
  s.bindir      = "exe"
  s.executables = ["postseed"]
  s.require_paths = ["lib"]
  s.metadata = {
    "source_code_uri" => "https://github.com/isagarpinninti/postseed/tree/main/wrappers/ruby",
    "bug_tracker_uri" => "https://github.com/isagarpinninti/postseed/issues",
    "changelog_uri"   => "https://github.com/isagarpinninti/postseed/blob/main/CHANGELOG.md"
  }
end
