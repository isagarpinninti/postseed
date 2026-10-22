# frozen_string_literal: true

require "json"
require "open3"
require "rbconfig"
require_relative "postseed/version"

# Postseed for Ruby: realistic, relationship-correct seed data for PostgreSQL.
#
# This gem carries the same engine as the +postseed+ npm package and runs it with Node.js 20 or newer. Use the
# +postseed+ command, or call Postseed.generate to get seed SQL for a schema from Ruby.
module Postseed
  MIN_NODE = 20
  ENGINE = File.expand_path("postseed/engine/postseed.mjs", __dir__)

  # The Postseed engine reported an error.
  class Error < StandardError; end

  # Node.js 20 or newer is required and was not found.
  class NodeNotFound < Error; end

  module_function

  # Path of a Node.js 20+ executable. Set POSTSEED_NODE to choose one explicitly.
  def find_node
    candidate = ENV["POSTSEED_NODE"]
    candidate = which("node") || which("nodejs") if candidate.nil? || candidate.empty?
    if candidate.nil?
      raise NodeNotFound,
            "Postseed needs Node.js #{MIN_NODE} or newer, and none was found on your PATH. " \
            "Install it from https://nodejs.org (or set POSTSEED_NODE to the node executable)."
    end
    out, status = begin
      Open3.capture2(candidate, "--version")
    rescue SystemCallError => e
      raise NodeNotFound, "Could not run Node.js at #{candidate} (#{e.message}). Postseed needs Node.js #{MIN_NODE} or " \
                          "newer; install it from https://nodejs.org or fix POSTSEED_NODE."
    end
    major = out.strip.sub(/\Av/, "").split(".").first.to_i
    if !status.success? || major < MIN_NODE
      raise NodeNotFound, "Postseed needs Node.js #{MIN_NODE} or newer; found #{out.strip} at #{candidate}."
    end
    candidate
  end

  def which(name)
    exts = ENV["PATHEXT"] ? ENV["PATHEXT"].split(";") : [""]
    ENV.fetch("PATH", "").split(File::PATH_SEPARATOR).each do |dir|
      exts.each do |ext|
        path = File.join(dir, "#{name}#{ext}")
        return path if File.file?(path) && File.executable?(path)
      end
    end
    nil
  end

  def command(args)
    raise Error, "The bundled engine is missing (#{ENGINE}). Reinstall the postseed gem." unless File.exist?(ENGINE)

    [find_node, ENGINE, *args.map(&:to_s)]
  end

  # Runs the CLI and captures its output. Returns [stdout, stderr, status]; does not raise on a non-zero exit.
  def run(args, input: nil)
    Open3.capture3(*command(args), stdin_data: input.to_s)
  end

  # Runs the CLI attached to this terminal and returns its exit code. This is what the +postseed+ executable uses.
  def exec(args)
    system(*command(args))
    status = $?
    return status.exitstatus if status && status.exitstatus

    status && status.termsig ? 128 + status.termsig : 1
  rescue NodeNotFound => e
    warn "postseed: #{e.message}"
    127
  rescue Error => e
    warn "postseed: #{e.message}"
    1
  end

  # Generates seed data for a CREATE TABLE script and returns it as text.
  #
  # +format+ is "sql" or "json" (CSV writes several files; use the CLI with --out). The same schema, seed and
  # Postseed version always return identical text. Raises Postseed::Error with the engine's message on failure.
  def generate(schema_sql, rows: 50, seed: 42, format: "sql", tables: nil, table_rows: nil, null_ratio: nil, now: nil)
    raise ArgumentError, 'format must be "sql" or "json" (use the CLI for csv)' unless %w[sql json].include?(format.to_s)

    args = ["generate", "--schema", "-", "--rows", Integer(rows), "--seed", Integer(seed), "--format", format.to_s]
    args += ["--tables", Array(tables).join(",")] if tables && !Array(tables).empty?
    args += ["--table-rows", table_rows.map { |k, v| "#{k}=#{Integer(v)}" }.join(",")] if table_rows && !table_rows.empty?
    args += ["--null-ratio", null_ratio.to_s] unless null_ratio.nil?
    args += ["--now", now.to_s] if now
    out, err, status = run(args, input: schema_sql)
    unless status.success?
      message = (err.to_s.strip.empty? ? out : err).to_s.strip
      raise Error, message.empty? ? "postseed exited with #{status.exitstatus}" : message
    end
    JSON.parse(out) if format.to_s == "json" # fail loudly if the output is not valid JSON
    out
  end
end
