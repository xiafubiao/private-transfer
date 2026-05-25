// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../../fhe-contracts/packages/fhe-contracts/contracts/lib/FHE.sol";
import "../../fhe-contracts/packages/fhe-contracts/contracts/config/PrimusConfig.sol";

/**
 * @title PrivateToken
 * @notice Encrypted ERC20 token - amounts are hidden on-chain
 * @dev Version B: Pure privacy, no regulatory whitelist
 */
contract PrivateToken is PrimusConfig {
    string private _name;
    string private _symbol;
    uint8 private _decimals;

    ve_uint256 private _totalSupply;
    mapping(address => ve_uint256) private _balances;
    mapping(address => mapping(address => ve_uint256)) private _allowances;

    event Transfer(address indexed from, address indexed to, ve_uint256 value);
    event Approval(address indexed owner, address indexed spender, ve_uint256 value);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        _name = name_;
        _symbol = symbol_;
        _decimals = decimals_;
    }

    function name() external view returns (string memory) {
        return _name;
    }

    function symbol() external view returns (string memory) {
        return _symbol;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function totalSupply() external view returns (ve_uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (ve_uint256) {
        return _balances[account];
    }

    function allowance(address owner, address spender) external view returns (ve_uint256) {
        return _allowances[owner][spender];
    }

    function transfer(address to, uve_uint256 calldata value) external payable chargeFee returns (bool) {
        ve_uint256 veValue = FHE.fromUnverified(value);

        _balances[msg.sender] = FHE.sub(_balances[msg.sender], veValue);
        _balances[to] = FHE.add(_balances[to], veValue);

        FHE.accessPolicy(_balances[msg.sender], msg.sender);
        FHE.accessPolicy(_balances[to], to);

        emit Transfer(msg.sender, to, veValue);
        return true;
    }

    function approve(address spender, uve_uint256 calldata value) external returns (bool) {
        ve_uint256 veValue = FHE.fromUnverified(value);

        _allowances[msg.sender][spender] = veValue;

        FHE.accessPolicy(_allowances[msg.sender][spender], msg.sender);
        FHE.accessPolicy(_allowances[msg.sender][spender], spender);

        emit Approval(msg.sender, spender, veValue);
        return true;
    }

    function transferFrom(address from, address to, uve_uint256 calldata value) external payable chargeFee returns (bool) {
        ve_uint256 veValue = FHE.fromUnverified(value);

        _allowances[from][msg.sender] = FHE.sub(_allowances[from][msg.sender], veValue);
        _balances[from] = FHE.sub(_balances[from], veValue);
        _balances[to] = FHE.add(_balances[to], veValue);

        FHE.accessPolicy(_balances[from], from);
        FHE.accessPolicy(_balances[to], to);
        FHE.accessPolicy(_allowances[from][msg.sender], from);
        FHE.accessPolicy(_allowances[from][msg.sender], msg.sender);

        emit Transfer(from, to, veValue);
        return true;
    }

    function mint(address to, uve_uint256 calldata value) external payable chargeFee returns (bool) {
        ve_uint256 veValue = FHE.fromUnverified(value);

        _totalSupply = FHE.add(_totalSupply, veValue);
        _balances[to] = FHE.add(_balances[to], veValue);

        FHE.accessPolicy(_totalSupply, msg.sender);
        FHE.accessPolicy(_balances[to], to);

        emit Transfer(address(0), to, veValue);
        return true;
    }

    function burn(uve_uint256 calldata value) external payable chargeFee returns (bool) {
        ve_uint256 veValue = FHE.fromUnverified(value);

        _balances[msg.sender] = FHE.sub(_balances[msg.sender], veValue);
        _totalSupply = FHE.sub(_totalSupply, veValue);

        FHE.accessPolicy(_balances[msg.sender], msg.sender);
        FHE.accessPolicy(_totalSupply, msg.sender);

        emit Transfer(msg.sender, address(0), veValue);
        return true;
    }
}